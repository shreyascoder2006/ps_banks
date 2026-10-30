import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from .config import MODEL_DIR

DB_PATH = Path(os.getenv("BANK_PULSE_DB", str(MODEL_DIR / "ps_banks.db")))
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


def _add_missing_columns() -> None:
    """Tiny forward-only migration: SQLModel.create_all never alters existing
    tables, so columns added to a model after the SQLite file was created are
    added here. Only nullable/defaulted columns are supported."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                coltype = col.type.compile(engine.dialect)
                default = ""
                if col.default is not None and getattr(col.default, "is_scalar", False):
                    val = col.default.arg
                    default = f" DEFAULT {int(val)}" if isinstance(val, bool) else (
                        f" DEFAULT {val}" if isinstance(val, (int, float)) else f" DEFAULT '{val}'")
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {coltype}{default}'))


def _backfill_legacy_provenance() -> None:
    """Rows written before provenance columns existed: no delivery integration
    has ever existed, so legacy outreach is a DB record only, and outcomes the
    old simulator wrote (notes say 'simulated') are not observed outcomes."""
    with engine.begin() as conn:
        conn.execute(text("UPDATE outreachaction SET simulated = 1 WHERE status = 'executed' AND simulated = 0"))
        conn.execute(text(
            "UPDATE outreachoutcome SET observed = 0, source = 'simulator' "
            "WHERE observed = 1 AND source = 'manual' AND lower(coalesce(notes, '')) LIKE '%simulated%'"))


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables)
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    _backfill_legacy_provenance()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
