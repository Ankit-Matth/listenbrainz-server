""" Spark job that downloads the latest listenbrainz dumps and imports into HDFS
"""
import logging
import tempfile
from datetime import datetime, timezone

import listenbrainz_spark.request_consumer.jobs.utils as utils
from listenbrainz_spark.dump import DumpType
from listenbrainz_spark.dump.local import ListenbrainzLocalDumpLoader
from listenbrainz_spark.ftp.download import ListenbrainzDataDownloader
from listenbrainz_spark.hdfs.upload import ListenbrainzDataUploader
from listenbrainz_spark.persisted import unpersist_incremental_df

logger = logging.getLogger(__name__)


def import_full_dump_to_hdfs(loader: ListenbrainzDataDownloader, dump_id: int = None) -> str:
    """ Import the full dump with the given dump_id if specified otherwise the
     latest full dump.

    Notes:
        Deletes all the existing listens and uploads listens from new dump.
    Args:
        loader: class to download dumps and load listens from it
        dump_id: id of the full dump to be imported
    Returns:
        the name of the imported dump
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        src, dump_name, dump_id = loader.load_listens(
            directory=temp_dir,
            dump_type=DumpType.FULL,
            listens_dump_id=dump_id
        )
        uploader = ListenbrainzDataUploader()
        uploader.upload_new_listens_full_dump(src)
        uploader.process_full_listens_dump()
    utils.insert_dump_data(dump_id, DumpType.FULL, datetime.now(tz=timezone.utc))
    unpersist_incremental_df()
    return dump_name


def import_incremental_dump_to_hdfs(loader: ListenbrainzDataDownloader, dump_id: int = None) -> str:
    """ Import the incremental dump with the given dump_id if specified otherwise the
     latest incremental dump.

    Notes:
        All incremental dumps are stored together in incremental.parquet inside the
        listens directory.
    Args:
        loader: class to download dumps and load listens from it
        dump_id: id of the incremental dump to be imported
    Returns:
        the name of the imported dump
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        src, dump_name, dump_id = loader.load_listens(
            directory=temp_dir,
            dump_type=DumpType.INCREMENTAL,
            listens_dump_id=dump_id
        )
        uploader = ListenbrainzDataUploader()
        uploader.upload_new_listens_incremental_dump(src)
        uploader.process_incremental_listens_dump()
    utils.insert_dump_data(dump_id, DumpType.INCREMENTAL, datetime.now(tz=timezone.utc))
    unpersist_incremental_df()
    return dump_name


def import_full_dump_handler(dump_id: int = None, local: bool = False):
    loader = ListenbrainzLocalDumpLoader() if local else ListenbrainzDataDownloader()
    errors = []
    dumps = []
    try:
        dumps.append(import_full_dump_to_hdfs(loader=loader, dump_id=dump_id))
    except Exception as e:
        logger.error("Error while importing full dump: ", exc_info=True)
        errors.append(str(e))
    return [{
        "type": "import_full_dump",
        "imported_dump": dumps,
        "errors": errors,
        "time": datetime.now(timezone.utc).isoformat(),
    }]


def import_incremental_dump_handler(dump_id: int = None, local: bool = False):
    loader = ListenbrainzLocalDumpLoader() if local else ListenbrainzDataDownloader()
    errors = []
    imported_dumps = []
    latest_full_dump = utils.get_latest_full_dump()
    if dump_id is not None:
        try:
            imported_dumps.append(import_incremental_dump_to_hdfs(loader, dump_id=dump_id))
        except Exception as e:
            logger.error("Error while importing incremental dump: ", exc_info=True)
            errors.append(str(e))
    elif latest_full_dump is None:
        # If no prior full dump is present, just import the latest incremental dump
        try:
            imported_dumps.append(import_incremental_dump_to_hdfs(loader, dump_id=None))
        except Exception as e:
            logger.error("Error while importing incremental dump: ", exc_info=True)
            errors.append(str(e))

        error_msg = "No previous full dump found, importing latest incremental dump"
        errors.append(error_msg)
        logger.warning(error_msg, exc_info=True)
    else:
        # Import all missing dumps from last full dump import
        start_id = latest_full_dump["dump_id"] + 1
        imported_at = latest_full_dump["imported_at"]
        end_id = ListenbrainzDataDownloader().get_latest_dump_id(DumpType.INCREMENTAL) + 1

        for dump_id in range(start_id, end_id, 1):
            if not utils.search_dump(dump_id, DumpType.INCREMENTAL, imported_at):
                try:
                    imported_dumps.append(import_incremental_dump_to_hdfs(loader, dump_id=dump_id))
                except Exception as e:
                    # Skip current dump if any error occurs during import
                    error_msg = f"Error while importing incremental dump with ID {dump_id}: {e}"
                    errors.append(error_msg)
                    logger.error(error_msg, exc_info=True)
                    continue
            dump_id += 1
    return [{
        "type": "import_incremental_dump",
        "imported_dump": imported_dumps,
        "errors": errors,
        "time": datetime.now(timezone.utc).isoformat(),
    }]
