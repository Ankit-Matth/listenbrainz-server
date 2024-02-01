from flask import Blueprint, render_template, current_app, request, jsonify
from flask_login import current_user
import orjson
from werkzeug.exceptions import NotFound, BadRequest
import psycopg2

from listenbrainz.db.similar_users import get_top_similar_users

explore_bp = Blueprint('explore', __name__)


@explore_bp.route("/similar-users/", methods=['POST'])
def similar_users():
    """ Show all of the users with the highest similarity in order to make
        them visible to all of our users. This view can show bugs in the algorithm
        and spammers as well.
    """

    similar_users = get_top_similar_users()

    return jsonify({
        "similarUsers": similar_users
    })


@explore_bp.route("/music-neighborhood/", methods=['POST'])
def artist_similarity():
    """ Explore artist similarity """

    with psycopg2.connect(current_app.config["SQLALCHEMY_TIMESCALE_URI"]) as ts_conn, \
            ts_conn.cursor() as ts_curs:
        ts_curs.execute("""
                        SELECT artist_mbid::TEXT
                            FROM popularity.artist
                            ORDER BY total_listen_count DESC
                            LIMIT 1
                            """)

        artist_mbid = ts_curs.fetchone()[0]
        current_app.logger.info(artist_mbid)

        data = {
            "algorithm": "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30",
            "artist_mbid": artist_mbid
        }

        return jsonify(data)


@explore_bp.route("/ai-brainz/")
def ai_brainz():
    """ Explore your love of Rick """

    return render_template("explore/ai-brainz.html")


@explore_bp.route("/lb-radio/", methods=["POST"])
def lb_radio():
    """ LB Radio view

        Possible page arguments:
           mode: string, must be easy, medium or hard.
           prompt: string, the prompt for playlist generation.
    """

    mode = request.args.get("mode", "")
    if mode != "" and mode not in ("easy", "medium", "hard"):
        raise BadRequest("mode parameter is required and must be one of 'easy', 'medium' or 'hard'")

    prompt = request.args.get("prompt", "")
    if prompt != "" and prompt == "":
        raise BadRequest("prompt parameter is required and must be non-zero length.")

    if current_user.is_authenticated:
        user = current_user.musicbrainz_id
        token = current_user.auth_token
    else:
        user = ""
        token = ""
    data = {
        "mode": mode,
        "prompt": prompt,
        "user": user,
        "token": token
    }

    return jsonify(data)


@explore_bp.route('/', defaults={'path': ''})
@explore_bp.route('/<path:path>/')
def index(path):
    """ Main explore page for users to browse the various explore features """

    return render_template(
        "index.html",
        props=orjson.dumps({}).decode("utf-8")
    )
