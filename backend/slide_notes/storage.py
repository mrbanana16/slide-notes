import hashlib
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine

BACKEND = Path(__file__).resolve().parents[1]


def migrate_database(path):
    engine = create_engine("sqlite:///" + str(path), connect_args={"timeout": 15})
    config = Config()
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.attributes["data_dir"] = path.parent
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("BEGIN")
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    except Exception:
        engine.dispose()
        raise
    return engine


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def create_backup(data):
    root = data / "backups"
    root.mkdir(exist_ok=True)
    backup_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid4().hex
    stage = Path(tempfile.mkdtemp(prefix=".backup-", dir=root))
    try:
        with closing(sqlite3.connect(data / "app.sqlite3")) as source, closing(sqlite3.connect(stage / "app.sqlite3")) as target:
            source.backup(target)
        shutil.copytree(data / "materials", stage / "materials")
        stage.replace(root / backup_id)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return backup_id


def reset_storage(data, engine, restore_from=None):
    stage = Path(tempfile.mkdtemp(prefix=".reset-", dir=data))
    fresh = stage / "fresh"
    backup = stage / "backup"
    fresh.mkdir()
    backup.mkdir()
    moved = []
    installed = []
    try:
        if restore_from is None:
            (fresh / "materials").mkdir()
        else:
            shutil.copy2(restore_from / "app.sqlite3", fresh / "app.sqlite3")
            shutil.copytree(restore_from / "materials", fresh / "materials")
            with closing(sqlite3.connect(fresh / "app.sqlite3")) as connection:
                if (connection.execute("PRAGMA quick_check").fetchone() != ("ok",)
                        or not connection.execute("SELECT version_num FROM alembic_version").fetchone()):
                    raise ValueError("Invalid backup database")
        clean_engine = migrate_database(fresh / "app.sqlite3")
        clean_engine.dispose()
        (fresh / "tmp").mkdir()
    except Exception:
        shutil.rmtree(stage)
        raise
    engine.dispose()
    try:
        for name in ("app.sqlite3", "app.sqlite3-wal", "app.sqlite3-shm", "app.sqlite3-journal", "materials", "tmp"):
            source = data / name
            if source.exists():
                source.replace(backup / name)
                moved.append(name)
        for source in fresh.iterdir():
            source.replace(data / source.name)
            installed.append(source.name)
    except Exception:
        for name in reversed(installed):
            target = data / name
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        for name in reversed(moved):
            (backup / name).replace(data / name)
        shutil.rmtree(stage)
        raise
    shutil.rmtree(stage)
