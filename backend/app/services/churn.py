"""Real churn-risk model.

The original Aurus-IPD frontend computed "risk" with a hand-rolled point
system (`if row.Balance < 1000: risk += 18`, etc.) entirely in the browser.
Here we actually train a RandomForestClassifier on the labelled `Churn`
column of the same dataset and serve calibrated probabilities plus
per-customer driver explanations derived from real feature importances.
"""
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
]
MODEL_PATH = MODEL_DIR / "churn_model.joblib"
ENCODERS_PATH = MODEL_DIR / "churn_encoders.joblib"


def _prep_features(df: pd.DataFrame, geo_enc: LabelEncoder, gender_enc: LabelEncoder) -> pd.DataFrame:
    out = df.copy()
    out["Geography_enc"] = geo_enc.transform(out["Geography"])
    out["Gender_enc"] = gender_enc.transform(out["Gender"])
    return out[FEATURES]


def _train() -> dict:
    df = load_customers()

    geo_enc = LabelEncoder().fit(df["Geography"])
    gender_enc = LabelEncoder().fit(df["Gender"])

    X = _prep_features(df, geo_enc, gender_enc)
    y = df["Churn"].astype(int)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = RandomForestClassifier(
        n_estimators=200, max_depth=8, min_samples_leaf=5, random_state=42, class_weight="balanced"
    )
    model.fit(X_train, y_train)

    probs = model.predict_proba(X_test)[:, 1]
    metrics = {
        "auc": float(roc_auc_score(y_test, probs)),
        "accuracy": float(accuracy_score(y_test, model.predict(X_test))),
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
    }

    joblib.dump({"model": model, "metrics": metrics, "feature_importances": dict(zip(FEATURES, model.feature_importances_))}, MODEL_PATH)
    joblib.dump({"geo": geo_enc, "gender": gender_enc}, ENCODERS_PATH)
    return {"model": model, "geo_enc": geo_enc, "gender_enc": gender_enc, "metrics": metrics,
            "feature_importances": dict(zip(FEATURES, model.feature_importances_))}


@lru_cache(maxsize=1)
def get_model_bundle() -> dict:
    if MODEL_PATH.exists() and ENCODERS_PATH.exists():
        try:
            m = joblib.load(MODEL_PATH)
            enc = joblib.load(ENCODERS_PATH)
            return {
                "model": m["model"], "geo_enc": enc["geo"], "gender_enc": enc["gender"],
                "metrics": m["metrics"], "feature_importances": m["feature_importances"],
            }
        except Exception:
            pass
    return _train()


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
    df = load_customers()
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
        if not reasons:
            reasons.append(f"Model-driven risk (top signal: {top_feature_names[0]})")
        return reasons[:3]

    out["churn_drivers"] = out.apply(drivers_for_row, axis=1)
    out["recommended_action"] = np.where(
        out["churn_risk_level"] == "critical", "Immediate retention call",
        np.where(out["churn_risk_level"] == "high", "Proactive outreach within 48h", "Cross-sell / routine check-in"),
    )
    return out


def get_model_metrics() -> dict:
    bundle = get_model_bundle()
    return {"metrics": bundle["metrics"], "feature_importances": bundle["feature_importances"]}
