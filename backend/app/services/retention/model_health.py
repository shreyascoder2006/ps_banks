"""Model health: evaluation metrics, calibration status, drift and data quality."""
import numpy as np

from ..churn import DRIFT_FEATURES, FEATURES, _augment, get_model_bundle
from ...data.loader import load_customers


def psi(reference_edges: list, reference_share: list, values: np.ndarray) -> float:
    edges = np.array(reference_edges, dtype=float)
    counts, _ = np.histogram(np.clip(values, edges[0], edges[-1]), bins=edges)
    cur = counts / max(counts.sum(), 1)
    ref = np.array(reference_share, dtype=float)
    ref, cur = np.clip(ref, 1e-4, None), np.clip(cur, 1e-4, None)
    return float(np.sum((cur - ref) * np.log(cur / ref)))


def _psi_label(v: float) -> str:
    return "stable" if v < 0.1 else "moderate shift" if v < 0.25 else "significant shift"


def build_health() -> dict:
    b = get_model_bundle()
    m = b["metrics"]
    df = _augment(load_customers())
    drift = []
    for col, ref in (m.get("drift_reference") or {}).items():
        if col in df:
            v = psi(ref["edges"], ref["share"], df[col].to_numpy(dtype=float))
            drift.append({"feature": col, "psi": round(v, 4), "status": _psi_label(v)})
    quality = {
        "rows": int(len(df)),
        "nullCells": int(df[FEATURES[:8]].isna().sum().sum()) if set(FEATURES[:8]) <= set(df.columns) else None,
        "balanceNegative": int((df["Balance"] < 0).sum()),
        "creditScoreOutOfRange": int(((df["CreditScore"] < 300) | (df["CreditScore"] > 900)).sum()),
        "duplicateCustomerIds": int(df["CustomerId"].duplicated().sum()),
    }
    return {
        "version": m.get("model_version"), "dataVersion": m.get("data_version"), "trainedAt": m.get("trained_at"),
        "algorithm": m.get("algorithm"), "evaluationMethod": m.get("evaluation"),
        "metrics": {k: m.get(k) for k in ("auc", "pr_auc", "accuracy", "precision", "recall", "f1", "brier", "threshold")},
        "confusion": m.get("confusion"), "calibration": m.get("calibration"),
        "calibrated": m.get("calibrated", False), "calibrationNote": m.get("calibration_note"),
        "trainRows": m.get("n_train"), "testRows": m.get("n_test"), "positiveRateTrain": m.get("positive_rate_train"),
        "feedbackRowsUsed": m.get("feedback_rows_used", 0),
        "featureSchema": m.get("feature_schema"),
        "featureImportances": dict(sorted(b["feature_importances"].items(), key=lambda kv: -kv[1])),
        "drift": drift, "dataQuality": quality,
        "limitations": [
            "Hold-out is a random split, not temporal - the dataset carries no timestamps, so temporal validation is not possible.",
            "Scores are an uncalibrated ranking (class_weight=balanced); do not read them as real churn probabilities.",
            "complaint_count and outreach_count are operational features that can change after an intervention; scores for already-contacted customers are not pre-intervention scores.",
            "Feedback rows are demo-scale: they move individual customers, not the headline metrics. Simulated outcomes are excluded from training.",
        ],
    }
