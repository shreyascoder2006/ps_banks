"""Read-only tools the chatbot can call to get live numbers.

Deliberately no write tools: the bot can look things up and recommend, but
triggering outreach, changing complaint status or writing to the audit
chain stays a human action in the UI.
"""
import json
from typing import Any, Optional

import numpy as np
import pandas as pd
from sqlmodel import select

from ...data.loader import load_customers
from ...db import session_scope
from ...models import Complaint
from ..churn import explain, get_model_metrics, score_all_customers, simulate
from ..complaint_insights import related_complaints, trends as complaint_trends
from ..complaints import to_dict as complaint_to_dict
from ..forecast import get_customer_growth_forecast
from ..market_sentiment import get_market_sentiment_index
from ..outreach import effectiveness, list_actions, recommend
from ..product_trends import get_product_trends
from ..segmentation import compute_personalised_offer, compute_segments

MAX_RESULT_CHARS = 3500

GROUP_COLUMNS = {
    "branch": "branch", "geography": "Geography", "gender": "Gender", "income_tier": "segment",
    "risk_level": "churn_risk_level", "num_products": "Num Of Products", "is_active": "Is Active Member",
    "has_credit_card": "Has Credit Card", "rfm_segment": "rfm_segment", "tenure": "Tenure",
    "historically_churned": "Churn",
}
METRICS = {
    "count": ("CustomerId", "count"),
    "avg_churn_risk": ("churn_risk_score", "mean"),
    "avg_balance": ("Balance", "mean"),
    "total_balance": ("Balance", "sum"),
    "avg_age": ("Age", "mean"),
    "avg_credit_score": ("CreditScore", "mean"),
    "avg_salary": ("Estimated Salary", "mean"),
    "avg_tenure": ("Tenure", "mean"),
    "avg_products": ("Num Of Products", "mean"),
    "historical_churn_rate_pct": ("Churn", "mean"),
}


def _customers_df() -> pd.DataFrame:
    df = score_all_customers()
    seg = compute_segments()[["CustomerId", "segment", "R_score", "F_score", "M_score"]].rename(columns={"segment": "rfm_segment"})
    return df.merge(seg, on="CustomerId", how="left")


def _brief(row) -> dict:
    return {
        "customerId": int(row["CustomerId"]), "surname": row["Surname"], "branch": row["branch"],
        "incomeTier": row["segment"], "age": int(row["Age"]), "balance": round(float(row["Balance"]), 2),
        "products": int(row["Num Of Products"]), "active": bool(row["Is Active Member"]),
        "churnRiskScore": float(row["churn_risk_score"]), "riskLevel": row["churn_risk_level"],
    }


def get_book_stats() -> dict:
    df = score_all_customers()
    lv = df["churn_risk_level"].value_counts().to_dict()
    at_risk = df[df["churn_risk_level"].isin(["critical", "high"])]
    return {
        "totalCustomers": int(len(df)),
        "byRiskLevel": {k: int(lv.get(k, 0)) for k in ("critical", "high", "medium", "low")},
        "totalBalance": round(float(df["Balance"].sum()), 2),
        "balanceAtRisk(critical+high)": round(float(at_risk["Balance"].sum()), 2),
        "avgChurnRiskScore": round(float(df["churn_risk_score"].mean()), 1),
        "historicalChurnRatePct": round(float(df["Churn"].mean() * 100), 1),
    }


def search_customers(query: str = "", risk_level: str = "", branch: str = "", income_tier: str = "",
                     geography: str = "", sort_by: str = "risk", limit: int = 8) -> dict:
    df = score_all_customers()
    if risk_level:
        df = df[df["churn_risk_level"] == risk_level.lower()]
    if branch:
        df = df[df["branch"].str.lower().str.contains(branch.lower(), na=False)]
    if income_tier:
        df = df[df["segment"] == income_tier.lower()]
    if geography:
        df = df[df["Geography"].str.lower() == geography.lower()]
    if query:
        q = str(query).strip().lower()
        df = df[df["Surname"].str.lower().str.contains(q, na=False) | df["account_no"].str.lower().str.contains(q, na=False)
                | df["CustomerId"].astype(str).str.contains(q, na=False)]
    col = {"risk": "churn_risk_score", "balance": "Balance", "age": "Age", "tenure": "Tenure"}.get(sort_by, "churn_risk_score")
    total = len(df)
    df = df.sort_values(col, ascending=False).head(max(1, min(int(limit), 15)))
    return {"matching": total, "showing": len(df), "customers": [_brief(r) for _, r in df.iterrows()]}


def get_customer(customer_id: int) -> dict:
    customer_id = int(customer_id)
    df = _customers_df()
    match = df[df["CustomerId"] == customer_id]
    if match.empty:
        return {"error": f"Customer {customer_id} not found (valid ids are in the dataset, e.g. 15634602)."}
    row = match.iloc[0]
    seg_full = compute_segments()
    srow = seg_full[seg_full["CustomerId"] == customer_id].iloc[0]
    offer = compute_personalised_offer(srow["recency"], srow["frequency"], srow["monetary"], srow["segment"])
    with session_scope() as s:
        complaints = [complaint_to_dict(c) for c in s.exec(select(Complaint).where(Complaint.customer_id == customer_id)).all()]
        actions = list_actions(s, customer_id)
    try:
        exp = explain(customer_id)
    except Exception:
        exp = None
    return {
        **_brief(row),
        "geography": row["Geography"], "gender": row["Gender"], "tenureYears": int(row["Tenure"]),
        "creditScore": int(row["CreditScore"]), "estimatedSalary": float(row["Estimated Salary"]),
        "hasCreditCard": bool(row["Has Credit Card"]), "accountNo": row["account_no"],
        "churnDrivers": list(row["churn_drivers"]), "recommendedAction": row["recommended_action"],
        "rfmSegment": row["rfm_segment"], "offer": offer, "loyaltyTokens": int(srow["loyalty_tokens"]),
        "explainability": exp,
        "complaints": [{k: c.get(k) for k in ("id", "subject", "severity", "status", "category")} for c in complaints],
        "outreachHistory": actions[:5],
    }


def what_if_customer(customer_id: int, is_active_member: Optional[int] = None, num_products: Optional[int] = None,
                     balance: Optional[float] = None, credit_score: Optional[int] = None, tenure: Optional[int] = None,
                     has_credit_card: Optional[int] = None, complaint_count: Optional[int] = None) -> dict:
    overrides = {"Is Active Member": is_active_member, "Num Of Products": num_products, "Balance": balance,
                 "CreditScore": credit_score, "Tenure": tenure, "Has Credit Card": has_credit_card,
                 "complaint_count": complaint_count}
    try:
        return simulate(int(customer_id), overrides)
    except KeyError:
        return {"error": f"Customer {customer_id} not found"}


def analyze_customers(group_by: str = "", metric: str = "count", risk_level: str = "", branch: str = "",
                      geography: str = "", gender: str = "", income_tier: str = "", rfm_segment: str = "",
                      min_age: int = 0, max_age: int = 200) -> dict:
    """Generic aggregation over the scored customer book for ad-hoc stats questions."""
    df = _customers_df()
    if risk_level:
        df = df[df["churn_risk_level"] == risk_level.lower()]
    if branch:
        df = df[df["branch"].str.lower().str.contains(branch.lower(), na=False)]
    if geography:
        df = df[df["Geography"].str.lower() == geography.lower()]
    if gender:
        df = df[df["Gender"].str.lower() == gender.lower()]
    if income_tier:
        df = df[df["segment"] == income_tier.lower()]
    if rfm_segment:
        df = df[df["rfm_segment"].str.lower() == rfm_segment.lower()]
    df = df[(df["Age"] >= int(min_age)) & (df["Age"] <= int(max_age))]
    if metric not in METRICS:
        return {"error": f"metric must be one of {sorted(METRICS)}"}
    col, fn = METRICS[metric]
    mult = 100 if metric == "historical_churn_rate_pct" else 1
    if not group_by:
        val = getattr(df[col], fn)() * mult if len(df) else None
        return {"rows": int(len(df)), metric: None if val is None else round(float(val), 2)}
    if group_by not in GROUP_COLUMNS:
        return {"error": f"group_by must be one of {sorted(GROUP_COLUMNS)}"}
    g = df.groupby(GROUP_COLUMNS[group_by])[col].agg(fn) * mult
    g = g.round(2).sort_values(ascending=False)
    return {"filteredRows": int(len(df)), "groupBy": group_by, "metric": metric,
            "result": {str(k): (float(v) if not float(v).is_integer() else int(v)) for k, v in g.items()}}


def list_segments() -> dict:
    df = compute_segments()
    s = df.groupby("segment").agg(customers=("CustomerId", "count"), avgBalance=("monetary", "mean"),
                                   offer=("offer_type", "first")).round(0).reset_index()
    return {"segments": s.to_dict(orient="records")}


def campaign_impact(segment: str, win_back_pct: float = 10) -> dict:
    seg = compute_segments()
    scored = score_all_customers()[["CustomerId", "churn_risk_score", "churn_risk_level"]]
    df = seg.merge(scored, on="CustomerId", how="left")
    df = df[df["segment"].str.lower() == segment.lower()]
    if df.empty:
        return {"error": f"Unknown RFM segment '{segment}'", "valid": sorted(seg["segment"].unique().tolist())}
    at_risk = df[df["churn_risk_level"].isin(["critical", "high"])]
    n = int(round(len(at_risk) * float(win_back_pct) / 100))
    top = at_risk.sort_values("monetary", ascending=False).head(n)
    return {"segment": segment, "segmentSize": int(len(df)), "atRiskCount": int(len(at_risk)),
            "atRiskBalance": round(float(at_risk["monetary"].sum()), 2), "winBackPct": win_back_pct,
            "customersRetained": n, "balanceProtected(upper bound)": round(float(top["monetary"].sum()), 2)}


def list_complaints(status: str = "", customer_id: int = 0) -> dict:
    with session_scope() as s:
        stmt = select(Complaint).order_by(Complaint.created_at.desc())
        if status:
            stmt = stmt.where(Complaint.status == status)
        if customer_id:
            stmt = stmt.where(Complaint.customer_id == int(customer_id))
        rows = [complaint_to_dict(c) for c in s.exec(stmt).all()]
    keep = ("id", "customerId", "customerName", "subject", "category", "severity", "status", "channel", "slaHours", "createdAt")
    return {"count": len(rows), "complaints": [{k: r.get(k) for k in keep} for r in rows[:15]]}


def get_complaint(complaint_id: str) -> dict:
    with session_scope() as s:
        c = s.get(Complaint, complaint_id)
        if not c:
            return {"error": f"Complaint {complaint_id} not found"}
        d = complaint_to_dict(c)
        d["related"] = related_complaints(s, complaint_id)
    return d


def get_complaint_trends() -> dict:
    with session_scope() as s:
        t = complaint_trends(s)
    t.pop("narrative", None)
    return t


def get_outreach_effectiveness() -> dict:
    with session_scope() as s:
        return effectiveness(s)


def recommend_outreach(customer_id: int) -> dict:
    with session_scope() as s:
        try:
            return recommend(s, int(customer_id))
        except KeyError:
            return {"error": f"Customer {customer_id} not found"}


def branch_summary() -> dict:
    df = score_all_customers()
    s = (df.groupby("branch").agg(customers=("CustomerId", "count"), avg_risk=("churn_risk_score", "mean"),
                                   balance=("Balance", "sum"),
                                   critical=("churn_risk_level", lambda x: int((x == "critical").sum()))).round(1).reset_index())
    return {"branches": s.to_dict(orient="records")}


def growth_forecast(periods: int = 3) -> dict:
    return get_customer_growth_forecast(periods=int(periods))


def product_trends(max_tenure: int = 3, geography: str = "") -> dict:
    return {"products": get_product_trends(max_tenure=int(max_tenure), geography=geography or None)}


def market_sentiment() -> dict:
    return get_market_sentiment_index()


def model_metrics() -> dict:
    return get_model_metrics()


def audit_records(limit: int = 5) -> dict:
    from ..blockchain import list_audit_records
    return list_audit_records(limit=int(limit))


def _p(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


S, I, N = {"type": "string"}, {"type": "integer"}, {"type": "number"}
RISK = {"type": "string", "description": "critical, high, medium or low"}
BRANCH = {"type": "string", "description": "Branch name or part of it, e.g. Mumbai"}

REGISTRY: dict[str, dict] = {
    "get_book_stats": (get_book_stats, "Whole-book KPIs: total customers, count per churn risk level, total balance, balance at risk, average risk.", _p({})),
    "search_customers": (search_customers, "List/search customers (top by risk by default). Filter by surname/id/account text, risk level, branch, income tier (retail, mass_affluent, hni), geography (France, Spain, Germany).",
                         _p({"query": S, "risk_level": RISK, "branch": BRANCH, "income_tier": S, "geography": S,
                             "sort_by": {"type": "string", "description": "risk, balance, age or tenure"}, "limit": I})),
    "get_customer": (get_customer, "Full profile of ONE customer: churn score and drivers, explainability, RFM segment, offer, complaints, outreach history.", _p({"customer_id": I}, ["customer_id"])),
    "what_if_customer": (what_if_customer, "Re-score one customer with hypothetical changes (e.g. make active, add products, change balance) using the real model.",
                         _p({"customer_id": I, "is_active_member": I, "num_products": I, "balance": N, "credit_score": I,
                             "tenure": I, "has_credit_card": I, "complaint_count": I}, ["customer_id"])),
    "analyze_customers": (analyze_customers, "Ad-hoc aggregate statistics over all 10,000 customers. group_by one of: " + ", ".join(sorted(GROUP_COLUMNS)) + ". metric one of: " + ", ".join(METRICS) + ". Optional filters.",
                          _p({"group_by": S, "metric": S, "risk_level": RISK, "branch": BRANCH, "geography": S, "gender": S,
                              "income_tier": S, "rfm_segment": S, "min_age": I, "max_age": I})),
    "list_segments": (list_segments, "RFM segments with customer counts, average balance and the offer for each.", _p({})),
    "campaign_impact": (campaign_impact, "What-if: balance protected if win_back_pct percent of a RFM segment's critical/high-risk customers are retained.",
                        _p({"segment": S, "win_back_pct": N}, ["segment"])),
    "list_complaints": (list_complaints, "List complaints, optionally by status (open, in_progress, escalated, resolved) or customer_id.", _p({"status": S, "customer_id": I})),
    "get_complaint": (get_complaint, "One complaint in detail (AI analysis, draft, messages, related complaints). id looks like CMP-0001.", _p({"complaint_id": S}, ["complaint_id"])),
    "get_complaint_trends": (get_complaint_trends, "Complaint analytics: counts by category/severity/channel/status, SLA breaches, resolution time, root-cause terms.", _p({})),
    "get_outreach_effectiveness": (get_outreach_effectiveness, "Outreach results: actions taken, outcomes, retention rate by channel.", _p({})),
    "recommend_outreach": (recommend_outreach, "Recommended outreach channel, offer and message for one customer, with reasons (does NOT send anything).", _p({"customer_id": I}, ["customer_id"])),
    "branch_summary": (branch_summary, "Per-branch customers, average risk, balance and critical-risk counts.", _p({})),
    "growth_forecast": (growth_forecast, "Customer growth projection (illustrative tenure-cohort trend).", _p({"periods": I})),
    "product_trends": (product_trends, "Product adoption of new vs established customers, optionally by geography.", _p({"max_tenure": I, "geography": S})),
    "market_sentiment": (market_sentiment, "Banking market sentiment index (0-100) with live/fallback source per component.", _p({})),
    "model_metrics": (model_metrics, "Churn model quality: AUC, accuracy, feature importances, training size.", _p({})),
    "audit_records": (audit_records, "Recent blockchain audit-trail records (or not_configured).", _p({"limit": I})),
}

TOOL_SPECS = [{"type": "function", "function": {"name": n, "description": d, "parameters": p}} for n, (_, d, p) in REGISTRY.items()]


def _default(o: Any):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def run_tool(name: str, args: dict) -> str:
    if name not in REGISTRY:
        return json.dumps({"error": f"unknown tool {name}", "available": list(REGISTRY)})
    fn = REGISTRY[name][0]
    try:
        out = fn(**(args or {}))
    except TypeError as exc:
        out = {"error": f"bad arguments: {exc}"}
    except Exception as exc:  # surface to the model so it can recover or explain
        out = {"error": f"{type(exc).__name__}: {exc}"}
    text = json.dumps(out, default=_default)
    return text if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + "...[truncated]"


_tool_index = None


def select_tools(question: str, k: int = 4) -> list:
    """Shortlist the few tools relevant to this question. Sending all ~18 tool
    schemas costs ~2k prompt tokens per request, which dominates latency on a
    CPU-only Ollama; sending none when the question is conceptual also stops the
    model from calling tools it doesn't need."""
    import re
    from sklearn.feature_extraction.text import TfidfVectorizer
    global _tool_index
    if _tool_index is None:
        names = list(REGISTRY)
        docs = [f"{n.replace('_', ' ')} {n.replace('_', ' ')} {REGISTRY[n][1]}" for n in names]
        vec = TfidfVectorizer(stop_words="english", sublinear_tf=True)
        _tool_index = (names, vec, vec.fit_transform(docs))
    names, vec, mat = _tool_index
    scores = (mat @ vec.transform([question]).T).toarray().ravel()
    ql = question.lower()
    live_cue = re.search(r"how many|how much|list|show|which|compare|top |highest|lowest|average|avg|total|count|"
                         r"who |find|search|what if|simulate|recommend|latest|current|now|open |breach", ql)
    conceptual = re.match(r"\s*(how (is|are|does|do|did)|what (is|are|does)|why|explain|describe|tell me (about|how))", ql)
    if conceptual and not live_cue and not re.search(r"\d{7,9}|cmp-\d+", ql):
        return []
    ranked = [names[i] for i in np.argsort(-scores) if scores[i] >= 0.08 and names[i] != "get_customer"][:k]
    if re.search(r"(?<!\d)\d{7,9}(?!\d)", question) and "get_customer" not in ranked:
        ranked.insert(0, "get_customer")
    if re.search(r"CMP-\d+", question, re.I) and "get_complaint" not in ranked:
        ranked.insert(0, "get_complaint")
    keep = set(ranked[: k + 1])
    return [t for t in TOOL_SPECS if t["function"]["name"] in keep]
