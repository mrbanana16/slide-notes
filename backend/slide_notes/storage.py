import hashlib
import shutil
import tempfile
from pathlib import Path

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
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    except Exception:
        engine.dispose()
        raise
    return engine


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def reset_storage(data, engine):
    stage = Path(tempfile.mkdtemp(prefix=".reset-", dir=data))
    fresh = stage / "fresh"
    backup = stage / "backup"
    fresh.mkdir()
    backup.mkdir()
    moved = []
    installed = []
    try:
        clean_engine = migrate_database(fresh / "app.sqlite3")
        clean_engine.dispose()
        (fresh / "materials").mkdir()
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
