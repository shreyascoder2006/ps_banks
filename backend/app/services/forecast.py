"""Deposit / customer-growth forecasting.

The original Outliers `model/training.py` + `model/forecast.py` trained
Prophet/ARIMA/XGBoost on daily retail-transaction aggregates (which this
dataset doesn't have — there's no per-transaction timestamp, only a coarse
`Tenure` in years). Rather than fabricate a fake daily time series, this
module builds a REAL yearly cohort series from `Tenure` (join-year cohorts,
customer counts, average balance per cohort) and fits a lightweight linear
trend model to project the next few years.

This is intentionally simpler than the original Prophet/ARIMA/XGBoost stack
and coarser (yearly, not daily) grain — documented in LIMITATIONS.md as an
illustrative trend projection, not a production forecasting model.
"""
from datetime import datetime

import numpy as np
import pandas as pd

from ..data.loader import load_customers

CURRENT_YEAR = datetime.now().year


def _cohort_series() -> pd.DataFrame:
    df = load_customers().copy()
    df["joined_year"] = CURRENT_YEAR - df["Tenure"].clip(lower=0, upper=10)

    cohort = (
        df.groupby("joined_year")
        .agg(new_customers=("CustomerId", "count"), avg_balance=("Balance", "mean"), total_balance=("Balance", "sum"))
        .reset_index()
        .sort_values("joined_year")
    )
    return cohort


def get_customer_growth_forecast(periods: int = 3) -> dict:
    cohort = _cohort_series()
    years = cohort["joined_year"].to_numpy(dtype=float)
    counts = cohort["new_customers"].to_numpy(dtype=float)

    coeffs = np.polyfit(years, counts, deg=1)
    trend = np.poly1d(coeffs)
    residual_std = float(np.std(counts - trend(years))) if len(years) > 2 else 0.0

    future_years = np.arange(years.max() + 1, years.max() + 1 + periods)
    future_counts = np.clip(trend(future_years), a_min=0, a_max=None)

    history = [
        {"year": int(y), "new_customers": int(c), "avg_balance": float(b)}
        for y, c, b in zip(cohort["joined_year"], cohort["new_customers"], cohort["avg_balance"])
    ]
    forecast = [
        {
            "year": int(y),
            "new_customers_forecast": round(float(c), 1),
            "lower": round(max(float(c) - 1.96 * residual_std, 0), 1),
            "upper": round(float(c) + 1.96 * residual_std, 1),
        }
        for y, c in zip(future_years, future_counts)
    ]

    total_balance_now = float(cohort["total_balance"].sum())
    avg_growth_rate = float(coeffs[0])

    return {
        "history": history,
        "forecast": forecast,
        "total_balance_current": round(total_balance_now, 2),
        "trend_slope_customers_per_year": round(avg_growth_rate, 2),
        "method": "linear trend on real tenure-cohort aggregates (illustrative, yearly grain)",
    }
