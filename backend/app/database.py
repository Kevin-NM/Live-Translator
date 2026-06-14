from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base

SQLALCHEMY_DATABASE_URL = "sqlite:///./live_translator.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_columns():
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table_name, columns in EXPECTED_COLUMNS.items():
            if table_name not in inspector.get_table_names():
                continue
            existing = {col["name"] for col in inspector.get_columns(table_name)}
            for col_name, col_def in columns.items():
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_def}"))


EXPECTED_COLUMNS = {
    "sessions": {
        "source_type": "VARCHAR DEFAULT 'manual'",
        "source_name": "VARCHAR",
        "source_url": "VARCHAR",
        "asr_provider": "VARCHAR",
        "provider_id": "INTEGER",
    },
    "segments": {
        "start_ms": "INTEGER",
        "end_ms": "INTEGER",
        "is_final": "BOOLEAN DEFAULT 1",
        "confidence": "FLOAT",
        "asr_provider": "VARCHAR",
        "latency_asr_ms": "FLOAT",
    },
}


def init_db():
    from app.models import Session, Segment, ProviderConfig, Setting  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_columns()
