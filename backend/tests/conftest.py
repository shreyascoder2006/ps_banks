import os
import sys
import tempfile
from pathlib import Path

# Isolated SQLite file; must be set before the app is imported.
_tmp = tempfile.mkdtemp(prefix="bankpulse_test_")
os.environ["BANK_PULSE_DB"] = str(Path(_tmp) / "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402


@pytest.fixture()
def session():
    from sqlmodel import SQLModel

    from app.db import engine, init_db, session_scope
    SQLModel.metadata.drop_all(engine)
    init_db()
    from app.services.churn import invalidate_scoring_cache
    invalidate_scoring_cache()
    with session_scope() as s:
        yield s


@pytest.fixture()
def customer_id():
    from app.data.loader import load_customers
    return int(load_customers().iloc[0]["CustomerId"])
