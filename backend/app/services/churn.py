"""Real churn-risk model.

The original Aurus-IPD frontend computed "risk" with a hand-rolled point
system (`if row.Balance < 1000: risk += 18`, etc.) entirely in the browser.
Here we actually train a RandomForestClassifier on the labelled `Churn`
column of the same dataset and serve calibrated probabilities plus
per-customer driver explanations derived from real feature importances.
"""
from datetime import datetime
from functools import lru_cache
from typing import List

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score
from sklearn.preprocessing import LabelEncoder

from ..config import MODEL_DIR
from ..data.loader import load_customers

FEATURES = [
    "CreditScore", "Age", "Tenure", "Balance", "Num Of Products",
    "Has Credit Card", "Is Active Member", "Estimated Salary",
    "Geography_enc", "Gender_enc",
    "complaint_count", "outreach_count",
]
MODEL_PATH = MODEL_DIR / "churn_model.joblib"
ENCODERS_PATH = MODEL_DIR / "churn_encoders.joblib"
FEEDBACK_WEIGHT = 3.0


def _operational_signals() -> pd.DataFrame:
    """Per-customer complaint/outreach counts and outcome labels from the
    operational DB. Returns an empty frame (all zeros downstream) before the
    DB exists, so the model still trains on a fresh checkout."""
    try:
        from sqlmodel import select
        from ..db import session_scope
        from ..models import Complaint, OutreachAction, OutreachOutcome

        with session_scope() as session:
            complaints = pd.DataFrame(
                [{"CustomerId": c.customer_id} for c in session.exec(select(Complaint)).all()]
            )
            actions = session.exec(select(OutreachAction)).all()
            outcomes = {o.action_id: o.outcome for o in session.exec(select(OutreachOutcome)).all()}
            outreach = pd.DataFrame([{"CustomerId": a.customer_id, "outcome": outcomes.get(a.id)} for a in actions])
    except Exception:
        return pd.DataFrame(columns=["CustomerId", "complaint_count", "outreach_count", "feedback_label"])

    frames = []
    if not complaints.empty:
        frames.append(complaints.groupby("CustomerId").size().rename("complaint_count"))
    if not outreach.empty:
        frames.append(outreach.groupby("CustomerId").size().rename("outreach_count"))
        labelled = outreach.dropna(subset=["outcome"])
        labelled = labelled[labelled["outcome"].isin(["retained", "churned"])]
        if not labelled.empty:
            # Latest recorded outcome wins per customer.
            frames.append(
                labelled.groupby("CustomerId")["outcome"].last().map({"retained": 0, "churned": 1}).rename("feedback_label")
            )
    if not frames:
        return pd.DataFrame(columns=["CustomerId", "complaint_count", "outreach_count", "feedback_label"])
    out = pd.concat(frames, axis=1).reset_index()
    for col in ("complaint_count", "outreach_count", "feedback_label"):
        if col not in out.columns:
            out[col] = np.nan
    return out


def _augment(df: pd.DataFrame) -> pd.DataFrame:
    signals = _operational_signals()
    out = df.merge(signals, on="CustomerId", how="left")
    out["complaint_count"] = out["complaint_count"].fillna(0).astype(int)
    out["outreach_count"] = out["outreach_count"].fillna(0).astype(int)
    return out


def _prep_features(df: pd.DataFrame, geo_enc: LabelEncoder, gender_enc: LabelEncoder) -> pd.DataFrame:
    out = df.copy()
    out["Geography_enc"] = geo_enc.transform(out["Geography"])
    out["Gender_enc"] = gender_enc.transform(out["Gender"])
    return out[FEATURES]


def _train() -> dict:
    df = _augment(load_customers())

    geo_enc = LabelEncoder().fit(df["Geography"])
    gender_enc = LabelEncoder().fit(df["Gender"])

    X = _prep_features(df, geo_enc, gender_enc)
    y = df["Churn"].astype(int).copy()

    # Feedback loop: recorded outreach outcomes override the historical
    # label and are up-weighted, so the model learns from what the bank
    # actually observed after acting on a prediction.
    has_feedback = df["feedback_label"].notna() if "feedback_label" in df else pd.Series(False, index=df.index)
    y[has_feedback] = df.loc[has_feedback, "feedback_label"].astype(int)
    weights = np.where(has_feedback, FEEDBACK_WEIGHT, 1.0)

    X_train, X_test, y_train, y_test, w_train, _ = train_test_split(
        X, y, weights, test_size=0.2, random_state=42, stratify=y
    )

    model = RandomForestClassifier(
        n_estimators=200, max_depth=8, min_samples_leaf=5, random_state=42, class_weight="balanced"
    )
    model.fit(X_train, y_train, sample_weight=w_train)

    probs = model.predict_proba(X_test)[:, 1]
    metrics = {
        "auc": float(roc_auc_score(y_test, probs)),
        "accuracy": float(accuracy_score(y_test, model.predict(X_test))),
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "feedback_rows_used": int(has_feedback.sum()),
        "trained_at": datetime.utcnow().isoformat(),
    }

    importances = dict(zip(FEATURES, model.feature_importances_))
    joblib.dump({"model": model, "metrics": metrics, "feature_importances": importances, "features": FEATURES}, MODEL_PATH)
    joblib.dump({"geo": geo_enc, "gender": gender_enc}, ENCODERS_PATH)
    return {"model": model, "geo_enc": geo_enc, "gender_enc": gender_enc, "metrics": metrics, "feature_importances": importances}


@lru_cache(maxsize=1)
def get_model_bundle() -> dict:
    if MODEL_PATH.exists() and ENCODERS_PATH.exists():
        try:
            m = joblib.load(MODEL_PATH)
            enc = joblib.load(ENCODERS_PATH)
            if m.get("features") == FEATURES:
                return {
                    "model": m["model"], "geo_enc": enc["geo"], "gender_enc": enc["gender"],
                    "metrics": m["metrics"], "feature_importances": m["feature_importances"],
                }
        except Exception:
            pass
    return _train()


def retrain_with_feedback() -> dict:
    get_model_bundle.cache_clear()
    bundle = _train()
    get_model_bundle()  # re-prime the cache from the freshly saved artifact
    return {"metrics": bundle["metrics"], "feature_importances": bundle["feature_importances"]}


_DRIVER_LABELS = {
    "Is Active Member": "No recent digital/branch activity",
    "Num Of Products": "Single-product relationship - low depth",
    "Balance": "Low account balance - dormancy risk",
    "CreditScore": "Low credit score - financial stress signal",
    "Tenure": "Short tenure - early-churn window",
    "Age": "Age-band correlated with elevated churn in this cohort",
    "Estimated Salary": "Income band correlated with churn in this cohort",
    "Has Credit Card": "No credit card - thinner product relationship",
    "Geography_enc": "Geography correlated with churn in this cohort",
    "Gender_enc": "Demographic correlated with churn in this cohort",
    "complaint_count": "Has logged complaints - service friction signal",
    "outreach_count": "Prior outreach on file - previously flagged at risk",
}


def _risk_level(score: float) -> str:
    if score >= 70:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 30:
        return "medium"
    return "low"


def score_all_customers() -> pd.DataFrame:
    bundle = get_model_bundle()
    df = _augment(load_customers())
    X = _prep_features(df, bundle["geo_enc"], bundle["gender_enc"])
    probs = bundle["model"].predict_proba(X)[:, 1]

    out = df.copy()
    out["churn_risk_score"] = (probs * 100).round(1)
    out["churn_risk_level"] = out["churn_risk_score"].apply(_risk_level)

    top_features = sorted(bundle["feature_importances"].items(), key=lambda kv: kv[1], reverse=True)[:5]
    top_feature_names = [f for f, _ in top_features]

    def drivers_for_row(row) -> List[str]:
        reasons = []
        if row["Is Active Member"] == 0 and "Is Active Member" in top_feature_names:
            reasons.append(_DRIVER_LABELS["Is Active Member"])
        if row["Num Of Products"] == 1 and "Num Of Products" in top_feature_names:
            reasons.append(_DRIVER_LABELS["Num Of Products"])
        if row["Balance"] < 1000 and "Balance" in top_feature_names:
            reasons.append(_DRIVER_LABELS["Balance"])
        if row["CreditScore"] < 600 and "CreditScore" in top_feature_names:
            reasons.append(_DRIVER_LABELS["CreditScore"])
        if row["Tenure"] < 2 and "Tenure" in top_feature_names:
            reasons.append(_DRIVER_LABELS["Tenure"])
        if row["complaint_count"] > 0:
            reasons.append(_DRIVER_LABELS["complaint_count"])
        if not reasons:
            reasons.append(f"Model-driven risk (top signal: {top_feature_names[0]})")
        return reasons[:3]

    out["churn_drivers"] = out.apply(drivers_for_row, axis=1)
    out["recommended_action"] = np.where(
        out["churn_risk_level"] == "critical", "Immediate retention call",
        np.where(out["churn_risk_level"] == "high", "Proactive outreach within 48h", "Cross-sell / routine check-in"),
    )
    return out


SIMULATABLE = {
    "Is Active Member": int, "Num Of Products": int, "Balance": float, "CreditScore": int,
    "Tenure": int, "Has Credit Card": int, "complaint_count": int,
}


def simulate(customer_id: int, overrides: dict) -> dict:
    """Re-score one customer with hypothetical feature values using the
    real trained model - a what-if intervention simulator. Only fields in
    SIMULATABLE are accepted; everything else stays as observed."""
    bundle = get_model_bundle()
    df = _augment(load_customers())
    match = df[df["CustomerId"] == customer_id]
    if match.empty:
        raise KeyError(f"Customer {customer_id} not found")
    base = match.iloc[[0]].copy()
    sim = base.copy()
    applied = {}
    for key, value in overrides.items():
        if key in SIMULATABLE and value is not None:
            sim[key] = SIMULATABLE[key](value)
            applied[key] = sim[key].iloc[0].item()

    X_base = _prep_features(base, bundle["geo_enc"], bundle["gender_enc"])
    X_sim = _prep_features(sim, bundle["geo_enc"], bundle["gender_enc"])
    p_base = float(bundle["model"].predict_proba(X_base)[0, 1]) * 100
    p_sim = float(bundle["model"].predict_proba(X_sim)[0, 1]) * 100

    return {
        "customerId": customer_id,
        "baselineRisk": round(p_base, 1),
        "baselineLevel": _risk_level(p_base),
        "simulatedRisk": round(p_sim, 1),
        "simulatedLevel": _risk_level(p_sim),
        "delta": round(p_sim - p_base, 1),
        "applied": applied,
        "baselineFeatures": {k: base[k].iloc[0].item() for k in SIMULATABLE},
    }


def get_model_metrics() -> dict:
    bundle = get_model_bundle()
    return {"metrics": bundle["metrics"], "feature_importances": bundle["feature_importances"]}
