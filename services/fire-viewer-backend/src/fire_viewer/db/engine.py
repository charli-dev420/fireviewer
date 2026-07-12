from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from fire_viewer.core.config import Settings


def create_db_engine(settings: Settings) -> Engine:
    connect_args: dict[str, object] = {}
    if settings.database_url.startswith("sqlite"):
        connect_args = {
            "check_same_thread": False,
            "timeout": settings.sqlite_busy_timeout_ms / 1_000,
        }

    engine = create_engine(
        settings.database_url,
        connect_args=connect_args,
        pool_pre_ping=True,
        future=True,
    )

    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def set_sqlite_pragmas(dbapi_connection: object, _connection_record: object) -> None:
            cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute(f"PRAGMA busy_timeout={settings.sqlite_busy_timeout_ms}")
            cursor.close()

    return engine


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, class_=Session, expire_on_commit=False, autoflush=False)


def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
    finally:
        session.close()
