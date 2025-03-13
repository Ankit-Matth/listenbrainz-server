"""
This script is responsible for generating recommendations for the users. The general flow is as follows:

The best_model saved in HDFS is loaded with the help of model_id which is fetched from model_metadata_df.
`spark_user_id` and `recording_id` are fetched from top_artist_candidate_set_df and are given as input to the
recommender. An RDD of `user`, `product` and `rating` is returned from the recommender which is later converted to
a dataframe by filtering top X (an int supplied as an argument to the script) recommendations for all users sorted on
prediction and fields renamed as `spark_user_id`, `recording_id` and `score`.
This dataframe is joined with recordings_df on recording_id to get the recording mbids which are then sent over the queue.
"""

import logging
import time
from collections import defaultdict

import pyspark.sql
from py4j.protocol import Py4JJavaError
from pyspark.ml.recommendation import ALSModel
from pyspark.sql.functions import col

import listenbrainz_spark
from listenbrainz_spark import utils, path
from listenbrainz_spark.exceptions import (PathNotFoundException,
                                           FileNotFetchedException,
                                           SparkSessionNotInitializedException,
                                           RecommendationsNotGeneratedException,
                                           EmptyDataframeExcpetion)
from listenbrainz_spark.path import RAW_RECOMMENDATIONS
from listenbrainz_spark.recommendations.recording.train_models import get_model_path
from listenbrainz_spark.stats import run_query
from listenbrainz_spark.utils import save_parquet

logger = logging.getLogger(__name__)


def get_most_recent_model_meta():
    """ Get model id of recently created model.

        Returns:
            model_id (str): Model identification string.
    """
    utils.read_files_from_HDFS(path.RECOMMENDATION_RECORDING_MODEL_METADATA).createOrReplaceTempView("model_metadata")
    meta = listenbrainz_spark.session.sql("""
        SELECT model_id, model_html_file
          FROM model_metadata
      ORDER BY model_created DESC
         LIMIT 1
    """).collect()[0]
    return meta.model_id, meta.model_html_file


def load_model(model_id):
    """ Load model from given path in HDFS.
    """
    dest_path = get_model_path(model_id)
    try:
        return ALSModel.load(dest_path)
    except Py4JJavaError as err:
        logger.error(f'Unable to load model "{model_id}"\n{str(err.java_exception)}\nAborting...', exc_info=True)
        raise


def process_recommendations(recommendation_df, limit):
    """ Process the recommendations generated by CF.

        1. Filter top X recommendations for each user on rating where X = limit.
        2. Convert the spark_user_id and recording_id used internally back to LB user_id and
           recording mbid respectively.
        3. Add the latest_listened_at time for the recommendation if it has been previously
           listened by the user.

        Save these recommendations to HDFS and then re-structure the recs to send it to LB via rabbitmq.

        Args:
            recommendation_df: Dataframe of user, product and rating.
            limit (int): Number of recommendations to be filtered for each user.

        Returns:
            recommendation_df: Dataframe of user_id, recording_mbid, rating and latest_listened_at.
    """
    recommendation_df.createOrReplaceTempView("recommendation")
    query = f"""
        WITH ranked_recommendation AS (
            SELECT spark_user_id
                 , recording_id
                 , prediction AS score
                 , row_number() OVER(PARTITION BY spark_user_id ORDER BY prediction DESC) AS rank
              FROM recommendation
        ), distinct_recommendations AS (
            SELECT u.user_id
                 , r.recording_mbid
                 , max(score) AS score
              FROM ranked_recommendation rr
              JOIN recording r
                ON r.recording_id = rr.recording_id
              JOIN user u
                ON rr.spark_user_id = u.spark_user_id
             WHERE rank <= {limit}
          GROUP BY user_id
                 , recording_mbid
        )   SELECT user_id
                 , recording_mbid
                 , score
                 , latest_listened_at
              FROM distinct_recommendations
         LEFT JOIN recording_discovery rd
             USING (user_id, recording_mbid)
    """
    df = run_query(query)
    save_parquet(df, RAW_RECOMMENDATIONS)
    df.createOrReplaceTempView("raw_recommendations")

    query = """
        SELECT user_id
             , array_sort(
                    collect_list(
                        struct(
                            recording_mbid
                          , score
                          , date_format(latest_listened_at, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") AS latest_listened_at
                        )
                    )
                  , (left, right) -> CASE
                                     WHEN left.score > right.score THEN -1
                                     WHEN left.score < right.score THEN  1
                                     ELSE 0
                                     END
                    -- sort in descending order of score
               ) AS recs
          FROM raw_recommendations
      GROUP BY user_id
    """
    return run_query(query)


def _is_empty_dataframe(df):
    """ Return True if the dataframe is empty, return False otherwise.
    """

    try:
        df.take(1)[0]
    except IndexError:
        return True

    return False


def generate_recommendations(candidate_set: pyspark.sql.DataFrame, model: ALSModel, limit: int):
    """ Generate recommendations from the candidate set.

        Args:
            candidate_set: Dataframe of spark_user_id and recording_id.
            model: ALS Model to use for making predictions.
            limit: Number of recommendations to be kept for each user.

        Returns:
            recommendation_df: Dataframe of spark_user_id, recording_id and rating.
    """
    recommendations = model.transform(candidate_set)

    if _is_empty_dataframe(recommendations):
        raise RecommendationsNotGeneratedException('Recommendations not generated!')

    recommendation_df = process_recommendations(recommendations, limit)
    return recommendation_df


def get_candidate_set_rdd_for_user(candidate_set_df, users):
    """ Get candidate set RDD for a given user.

        Args:
            candidate_set_df: A dataframe of spark_user_id and recording_id for all users.
            users: list of user names to generate recommendations for.

        Returns:
            candidate_set_rdd: An RDD of spark_user_id and recording_id for a given user.
    """
    if users:
        candidate_set_user_df = candidate_set_df.select('spark_user_id', 'recording_id') \
                                                .where(col('user_id').isin(users))
    else:
        candidate_set_user_df = candidate_set_df.select('spark_user_id', 'recording_id')

    if _is_empty_dataframe(candidate_set_user_df):
        raise EmptyDataframeExcpetion('Empty Candidate sets!')

    return candidate_set_user_df


def get_user_name_and_user_id(all_users_df, users):
    """ Get users from top artist candidate set.

        Args:
            all_users_df: dataframe of all users
            users: list of users names to generate recommendations.

        Returns:
            users_df: dataframe of user id and user names.
    """
    if len(users) == 0:
        users_df = all_users_df.select('spark_user_id', 'user_id').distinct()
    else:
        users_df = all_users_df \
            .select('spark_user_id', 'user_id') \
            .where(all_users_df.user_id.isin(users)) \
            .distinct()

    if _is_empty_dataframe(users_df):
        raise EmptyDataframeExcpetion('No active users found!')

    return users_df


def create_messages(model_id, model_html_file, raw_recs_df, active_user_count, total_time):
    """ Create messages to send the data to the webserver via RabbitMQ.

        Args:
            model_id: the id of the model
            model_html_file: the html report file name for the model
            raw_recs_df (dataframe): Raw recommendations.
            active_user_count (int): Number of users active in the last week.
            total_time (float): Time taken in exceuting the whole script.

        Returns:
            messages: A list of messages to be sent via RabbitMQ
    """
    user_rec = defaultdict(lambda: {
        "raw": []
    })

    raw_rec_itr = raw_recs_df.toLocalIterator()
    raw_rec_user_count = 0
    for row in raw_rec_itr:
        row_dict = row.asDict(recursive=True)
        user_rec[row_dict["user_id"]]["raw"] = row_dict["recs"]
        raw_rec_user_count += 1

    for user_id, data in user_rec.items():
        messages = {
            'user_id': user_id,
            'type': 'cf_recommendations_recording_recommendations',
            'recommendations': {
                'raw': data['raw'],
                'model_id': model_id,
                'model_url': f"http://michael.metabrainz.org/{model_html_file}"
            }
        }
        yield messages

    yield {
        'type': 'cf_recommendations_recording_mail',
        'active_user_count': active_user_count,
        'raw_rec_user_count': raw_rec_user_count,
        'total_time': '{:.2f}'.format(total_time / 3600)
    }


def get_recommendations_for_candidate_set(model, candidate_set_df, limit, users):
    """ Get recommendations for all active users using given candidate set.

        Args:
            model: the ALSModel to use to predict tracks
            candidate_set_df: the candidate set to feed as input to model
            limit: maximum number of recs to generate per user
            users: list of users names to generate recommendations.

        Returns:
            recs_df: generated recommendations.
    """
    try:
        candidate_subset = get_candidate_set_rdd_for_user(candidate_set_df, users)
        recs_df = generate_recommendations(candidate_subset, model, limit)
        return recs_df
    except EmptyDataframeExcpetion:
        logger.error('Candidate set not found for any user.', exc_info=True)
        raise
    except RecommendationsNotGeneratedException:
        logger.error('Recommendations not generated for any user', exc_info=True)
        raise


def get_raw_recommendations(model: ALSModel, limit, users_df):
    """Get recommendations from the model directly based on the data on which it was initially trained.

        Args:
            model: the ALSModel to use to predict tracks
            limit: maximum number of recs to generate per user
            users_df: list of users names to generate recommendations.

        Returns:
            recs_df: generated recommendations.
    """
    raw_recommendations = model.recommendForUserSubset(users_df.select('spark_user_id'), limit)
    raw_recommendations.createOrReplaceTempView("raw_recommendations")
    recommendations = run_query("""
        WITH expanded_recs AS (
            SELECT spark_user_id
                 , explode(recommendations) AS rec
              FROM raw_recommendations
        )
        SELECT spark_user_id
             , rec.recording_id
             , rec.rating AS prediction
          FROM expanded_recs
    """)
    recs_df = process_recommendations(recommendations, limit)
    return recs_df


def get_user_count(df):
    """ Get distinct user count from the given dataframe. """
    return df.select('user_id').distinct().count()


def main(recommendation_raw_limit=None, users=None):
    try:
        recordings_df = utils.read_files_from_HDFS(path.RECOMMENDATION_RECORDINGS_DATAFRAME)
        all_users_df = utils.read_files_from_HDFS(path.RECOMMENDATION_RECORDING_USERS_DATAFRAME)

        recordings_df.createOrReplaceTempView("recording")
        utils.read_files_from_HDFS(path.RECORDING_DISCOVERY).createOrReplaceTempView("recording_discovery")
    except PathNotFoundException as err:
        logger.error(str(err), exc_info=True)
        raise
    except FileNotFetchedException as err:
        logger.error(str(err), exc_info=True)
        raise

    logger.info('Loading model...')
    model_id, model_html_file = get_most_recent_model_meta()
    model = load_model(model_id)

    # an action must be called to persist data in memory
    recordings_df.count()
    recordings_df.persist()

    try:
        # timestamp when the script was invoked
        ts_initial = time.monotonic()
        users_df = get_user_name_and_user_id(all_users_df, users)
        # Some users are excluded from the top_artist_candidate_set because of the limited data
        # in the mapping. Therefore, active_user_count may or may not be equal to number of users
        # active in the last week. Ideally, top_artist_candidate_set should give the active user count.
        active_user_count = users_df.count()
        users_df.persist()

        users_df.createOrReplaceTempView("user")
        logger.info('Took {:.2f}sec to get active user count'.format(time.monotonic() - ts_initial))
    except EmptyDataframeExcpetion as err:
        logger.error(str(err), exc_info=True)
        raise

    logger.info('Generating recommendations...')
    ts = time.monotonic()
    raw_recs_df = get_raw_recommendations(model, recommendation_raw_limit, users_df)
    logger.info('Recommendations generated!')
    logger.info('Took {:.2f}sec to generate recommendations for all active users'.format(time.monotonic() - ts))

    # persisted data must be cleared from memory after usage to avoid OOM
    recordings_df.unpersist()

    total_time = time.monotonic() - ts_initial
    logger.info('Total time: {:.2f}sec'.format(total_time))

    result = create_messages(model_id, model_html_file, raw_recs_df, active_user_count, total_time)

    users_df.unpersist()

    return result
