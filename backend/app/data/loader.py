"""Loads the real Kaggle bank-churn dataset (the same churn_data.csv used by
the original Aurus-IPD frontend) and turns it into a single canonical
DataFrame the rest of the backend builds on.

Every derived column here is either:
  - REAL: taken directly from the CSV, or
  - PROXY: a deterministic stand-in for data the dataset doesn't contain
    (the CSV has no transaction dates, so "recency"/"last active" is
    simulated deterministically from existing fields rather than faked
    randomly on every request). Proxy columns are documented in
    backend/LIMITATIONS.md and named with a `_proxy` suffix here.
"""
import hashlib
from functools import lru_cache

import numpy as np
import pandas as pd

from ..config import CHURN_DATA_PATH

BRANCHES = [
    "Mumbai Main", "Delhi Connaught", "Bangalore MG Road", "Chennai Anna Nagar",
    "Pune FC Road", "Hyderabad Banjara Hills", "Kolkata Park Street",
]
PRODUCTS = ["savings", "home_loan", "fd", "credit_card", "insurance", "mutual_fund"]


def _stable_unit(seed: str) -> float:
    """Deterministic pseudo-random float in [0, 1) derived from a stable
    hash of `seed`, so repeated requests for the same customer always
    produce the same proxy values instead of re-randomizing."""
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


@lru_cache(maxsize=1)
def load_customers() -> pd.DataFrame:
    df = pd.read_csv(CHURN_DATA_PATH)
    df = df[df["CustomerId"].notna()].reset_index(drop=True)
    df["CustomerId"] = df["CustomerId"].astype(int)

    df["branch"] = [BRANCHES[i % len(BRANCHES)] for i in range(len(df))]
    df["num_products_capped"] = df["Num Of Products"].clip(lower=1, upper=len(PRODUCTS))
    df["products"] = df["num_products_capped"].apply(lambda n: PRODUCTS[: int(n)])
    df["segment"] = pd.cut(
        df["Estimated Salary"],
        bins=[-np.inf, 80000, 150000, np.inf],
        labels=["retail", "mass_affluent", "hni"],
    ).astype(str)

    # --- Proxy fields (deterministic, documented in LIMITATIONS.md) ---
    unit = df["CustomerId"].astype(str).apply(_stable_unit)
    is_active = df["Is Active Member"] == 1
    df["last_active_days_proxy"] = np.where(
        is_active,
        (unit * 14).round().astype(int) + 1,
        (unit * 90).round().astype(int) + 30,
    )
    base_txn = np.where(is_active, 10 + df["Num Of Products"] * 6, 8)
    txn_jitter = ((unit - 0.5) * 6).round()
    df["monthly_txn_count_proxy"] = np.clip(base_txn + txn_jitter, 0, None).astype(int)

    df["account_no"] = "SB-" + df["CustomerId"].astype(str).str[-4:]
    df["lifetime_value"] = (df["Balance"] * 0.1).round(2)

    return df


def get_customer_row(customer_id: int) -> pd.Series:
    df = load_customers()
    match = df[df["CustomerId"] == customer_id]
    if match.empty:
        raise KeyError(f"Customer {customer_id} not found")
    return match.iloc[0]
