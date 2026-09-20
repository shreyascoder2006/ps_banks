"""Repurposed "Trend Analysis" module.

The original Outliers `trends/analysis.py` generated 90 days of entirely
synthetic engagement data (random walks with scripted "viral spikes") for
generic retail sectors — no real signal at all. For a banking context we
replace that with a genuinely data-derived metric: product adoption rate by
customer tenure cohort, computed directly from the real churn dataset.

Trend score = adoption rate among newer customers (tenure <= 3y) / adoption
rate among longer-tenured customers (tenure > 3y). A score > 1 means the
product is gaining share among newer relationships relative to older ones —
a real (if coarse) signal of which products are picking up traction, given
this dataset has no purchase-date log to compute a true time series.
"""
import pandas as pd

from ..data.loader import PRODUCTS, load_customers

NEW_COHORT_MAX_TENURE = 3


def get_product_trends() -> list[dict]:
    df = load_customers()
    new_cohort = df[df["Tenure"] <= NEW_COHORT_MAX_TENURE]
    old_cohort = df[df["Tenure"] > NEW_COHORT_MAX_TENURE]

    results = []
    for idx, product in enumerate(PRODUCTS):
        # A customer "holds" product[i] if their product count > i (products
        # list is built by slicing PRODUCTS[:num_products] in the loader).
        new_holders = new_cohort["num_products_capped"].apply(lambda n: n > idx).mean() if len(new_cohort) else 0.0
        old_holders = old_cohort["num_products_capped"].apply(lambda n: n > idx).mean() if len(old_cohort) else 0.0

        trend_score = (new_holders / old_holders) if old_holders > 0 else (2.0 if new_holders > 0 else 1.0)
        results.append({
            "product": product,
            "adoption_rate_new_cohort": round(float(new_holders) * 100, 2),
            "adoption_rate_established_cohort": round(float(old_holders) * 100, 2),
            "trend_score": round(float(trend_score), 2),
            "status": "trending" if trend_score > 1.15 else ("declining" if trend_score < 0.85 else "stable"),
        })

    return sorted(results, key=lambda r: r["trend_score"], reverse=True)
