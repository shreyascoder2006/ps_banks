"""Banking RFM segmentation, offers, and loyalty tokens.

Adapted from the original Outliers `crm/rfm.py` / `crm/offers.py`, which
computed classic e-commerce RFM (Recency/Frequency/Monetary) from
per-invoice retail transactions. The bank-churn dataset has no invoice-level
transaction log, so R/F/M are re-derived from the closest real+proxy signals
available on each customer:

  Recency  <- last_active_days_proxy   (see data/loader.py; proxy)
  Frequency <- monthly_txn_count_proxy (proxy) blended with Num Of Products (real)
  Monetary <- Balance (real)

The quantile scoring, segment rules, offer economics, and loyalty-token
formula are otherwise unchanged from the original, just relabelled for a
banking retention context instead of e-commerce discounts.
"""
from typing import Dict

import numpy as np
import pandas as pd

from ..data.loader import load_customers

SEGMENT_OFFERS: Dict[str, Dict[str, str]] = {
    "Champions": {
        "offer_type": "Wealth Desk Priority Review",
        "message": "You're one of our most valuable relationships. We'd like to offer a complimentary portfolio review with a dedicated relationship manager.",
    },
    "Loyal Customers": {
        "offer_type": "Preferred Rate Fixed Deposit",
        "message": "Thank you for your continued trust. You're eligible for a preferential FD rate on renewal.",
    },
    "Potential Loyalists": {
        "offer_type": "Fee Waiver + Cross-sell",
        "message": "You're building a strong relationship with us. Enjoy a waived annual fee and a tailored insurance quote.",
    },
    "At-Risk": {
        "offer_type": "Retention Call + Rate Match",
        "message": "We've noticed reduced activity. A relationship manager will reach out with a retention offer this week.",
    },
    "Hibernating": {
        "offer_type": "Reactivation Package",
        "message": "It's been a while — reactivate your account and we'll waive dormancy charges plus a welcome-back cashback.",
    },
    "New Customers": {
        "offer_type": "Welcome Bundle",
        "message": "Welcome aboard! Enjoy a fee-free first year and a complimentary debit card upgrade.",
    },
    "Others": {
        "offer_type": "Standard Relationship Review",
        "message": "Explore products tailored to your banking profile.",
    },
}


def _assign_segment(row) -> str:
    r, f, m = row["R_score"], row["F_score"], row["M_score"]
    if r >= 4 and f >= 4 and m >= 4:
        return "Champions"
    if r >= 3 and f >= 3 and m >= 3:
        return "Loyal Customers"
    if r >= 4 and f >= 2:
        return "Potential Loyalists"
    if r <= 2 and f >= 3:
        return "At-Risk"
    if r <= 2 and f <= 2:
        return "Hibernating"
    if r >= 4 and f == 1:
        return "New Customers"
    return "Others"


def compute_segments() -> pd.DataFrame:
    df = load_customers().copy()

    df["recency"] = df["last_active_days_proxy"]
    df["frequency"] = df["monthly_txn_count_proxy"] + df["Num Of Products"]
    df["monetary"] = df["Balance"]

    df["R_score"] = pd.qcut(df["recency"].rank(method="first"), 5, labels=[5, 4, 3, 2, 1]).astype(int)
    df["F_score"] = pd.qcut(df["frequency"].rank(method="first"), 5, labels=[1, 2, 3, 4, 5]).astype(int)
    df["M_score"] = pd.qcut(df["monetary"].rank(method="first"), 5, labels=[1, 2, 3, 4, 5]).astype(int)
    df["RFM_score"] = df[["R_score", "F_score", "M_score"]].sum(axis=1)

    df["segment"] = df.apply(_assign_segment, axis=1)

    offers = df["segment"].map(SEGMENT_OFFERS)
    df["offer_type"] = offers.apply(lambda x: x["offer_type"])
    df["offer_message"] = offers.apply(lambda x: x["message"])

    df["loyalty_tokens"] = df.apply(
        lambda row: compute_loyalty_tokens(row["recency"], row["frequency"], row["monetary"], row["segment"]),
        axis=1,
    )
    return df


def compute_personalised_offer(recency: float, frequency: float, monetary: float, segment: str) -> Dict[str, str]:
    base = SEGMENT_OFFERS.get(segment, SEGMENT_OFFERS["Others"])
    reasons = []
    bonus_pct = 0

    if monetary > 1_000_000:
        bonus_pct += 5
        reasons.append("High-balance relationship (> ₹10L).")
    elif monetary > 500_000:
        bonus_pct += 3
        reasons.append("Strong-balance relationship (> ₹5L).")

    if recency > 60:
        reasons.append("Extended inactivity — retention priority applied.")
    elif recency > 30:
        reasons.append("Moderate inactivity — proactive outreach recommended.")

    if segment == "Champions":
        reasons.append("Top-tier relationship (Champions segment).")

    message = base["message"] + (" " + " ".join(reasons) if reasons else "")
    return {"offer_type": base["offer_type"], "message": message, "priority_bonus_pct": str(bonus_pct)}


def compute_loyalty_tokens(recency: float, frequency: float, monetary: float, segment: str) -> int:
    base_tokens = int(max(monetary, 0) // 1000)
    activity_bonus = max(int(frequency) - 1, 0) * 5

    segment_bonus = {
        "Champions": 50, "Loyal Customers": 30, "Potential Loyalists": 20,
        "At-Risk": 10, "Hibernating": 10,
    }.get(segment, 0)

    recent_activity_bonus = 20 if recency < 15 else 10 if recency < 45 else 0

    return int(max(base_tokens + activity_bonus + segment_bonus + recent_activity_bonus, 0))
