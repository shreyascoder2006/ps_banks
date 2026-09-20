from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import User, get_current_user
from ..db import get_session
from ..models import Complaint
from ..services.churn import explain, get_model_metrics, score_all_customers, simulate
from ..services.complaints import to_dict as complaint_to_dict
from ..services.outreach import list_actions
from ..services.segmentation import compute_personalised_offer, compute_segments

router = APIRouter(prefix="/customers", tags=["customers"])


def _row_to_dict(row) -> dict:
    return {
        "customerId": int(row["CustomerId"]),
        "surname": row["Surname"],
        "accountNo": row["account_no"],
        "branch": row["branch"],
        "segment": row["segment"],
        "products": row["products"],
        "geography": row["Geography"],
        "gender": row["Gender"],
        "age": int(row["Age"]),
        "tenure": int(row["Tenure"]),
        "balance": float(row["Balance"]),
        "creditScore": int(row["CreditScore"]),
        "estimatedSalary": float(row["Estimated Salary"]),
        "complaintCount": int(row["complaint_count"]),
        "outreachCount": int(row["outreach_count"]),
        "isActiveMember": bool(row["Is Active Member"]),
        "lifetimeValue": float(row["lifetime_value"]),
        "churnRiskScore": float(row["churn_risk_score"]),
        "churnRiskLevel": row["churn_risk_level"],
        "churnDrivers": row["churn_drivers"],
        "recommendedAction": row["recommended_action"],
        "lastActiveDaysProxy": int(row["last_active_days_proxy"]),
    }


SORTABLE = {
    "risk": "churn_risk_score", "balance": "Balance", "surname": "Surname",
    "tenure": "Tenure", "creditScore": "CreditScore", "age": "Age",
}


@router.get("")
def list_customers(
    risk_level: str | None = Query(default=None, alias="riskLevel"),
    branch: str | None = None,
    segment: str | None = None,
    q: str | None = None,
    sort: str = "risk",
    order: str = "desc",
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
):
    df = score_all_customers()
    if risk_level:
        df = df[df["churn_risk_level"] == risk_level]
    if branch:
        df = df[df["branch"] == branch]
    if segment:
        df = df[df["segment"] == segment]
    if q:
        needle = q.strip().lower()
        df = df[
            df["Surname"].str.lower().str.contains(needle, na=False)
            | df["account_no"].str.lower().str.contains(needle, na=False)
            | df["CustomerId"].astype(str).str.contains(needle, na=False)
        ]
    total = len(df)
    df = df.sort_values(SORTABLE.get(sort, "churn_risk_score"), ascending=(order == "asc"))
    df = df.iloc[offset: offset + limit]
    return {"count": len(df), "total": total, "customers": [_row_to_dict(r) for _, r in df.iterrows()]}


@router.get("/stats")
def stats(current_user: User = Depends(get_current_user)):
    """Book-wide aggregates over ALL customers (not a page), for the Overview."""
    df = score_all_customers()
    by_level = df["churn_risk_level"].value_counts().to_dict()
    at_risk = df[df["churn_risk_level"].isin(["critical", "high"])]
    top = df.sort_values("churn_risk_score", ascending=False).head(5)
    return {
        "total": int(len(df)),
        "byRiskLevel": {lvl: int(by_level.get(lvl, 0)) for lvl in ("critical", "high", "medium", "low")},
        "totalBalance": round(float(df["Balance"].sum()), 2),
        "balanceAtRisk": round(float(at_risk["Balance"].sum()), 2),
        "avgRisk": round(float(df["churn_risk_score"].mean()), 1),
        "watchlist": [_row_to_dict(r) for _, r in top.iterrows()],
    }


@router.get("/branches")
def branches(current_user: User = Depends(get_current_user)):
    df = score_all_customers()
    summary = (
        df.groupby("branch")
        .agg(customers=("CustomerId", "count"), avg_risk=("churn_risk_score", "mean"), balance=("Balance", "sum"),
             critical=("churn_risk_level", lambda s: int((s == "critical").sum())))
        .reset_index()
    )
    return {"branches": summary.round(1).to_dict(orient="records")}


class SimulateRequest(BaseModel):
    is_active_member: Optional[int] = None
    num_products: Optional[int] = None
    balance: Optional[float] = None
    credit_score: Optional[int] = None
    tenure: Optional[int] = None
    has_credit_card: Optional[int] = None
    complaint_count: Optional[int] = None


@router.get("/{customer_id}/explain")
def explain_customer(customer_id: int, current_user: User = Depends(get_current_user)):
    try:
        return explain(customer_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Customer not found")


@router.post("/{customer_id}/simulate")
def simulate_customer(customer_id: int, body: SimulateRequest, current_user: User = Depends(get_current_user)):
    overrides = {
        "Is Active Member": body.is_active_member,
        "Num Of Products": body.num_products,
        "Balance": body.balance,
        "CreditScore": body.credit_score,
        "Tenure": body.tenure,
        "Has Credit Card": body.has_credit_card,
        "complaint_count": body.complaint_count,
    }
    try:
        return simulate(customer_id, overrides)
    except KeyError:
        raise HTTPException(status_code=404, detail="Customer not found")


@router.get("/{customer_id}")
def get_customer(customer_id: int, current_user: User = Depends(get_current_user)):
    df = score_all_customers()
    match = df[df["CustomerId"] == customer_id]
    if match.empty:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _row_to_dict(match.iloc[0])


@router.get("/{customer_id}/360")
def customer_360(customer_id: int, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    df = score_all_customers()
    match = df[df["CustomerId"] == customer_id]
    if match.empty:
        raise HTTPException(status_code=404, detail="Customer not found")
    profile = _row_to_dict(match.iloc[0])

    seg = compute_segments()
    seg_row = seg[seg["CustomerId"] == customer_id].iloc[0]
    offer = compute_personalised_offer(seg_row["recency"], seg_row["frequency"], seg_row["monetary"], seg_row["segment"])

    complaints = session.exec(
        select(Complaint).where(Complaint.customer_id == customer_id).order_by(Complaint.created_at.desc())
    ).all()

    return {
        **profile,
        "rfm": {
            "segment": seg_row["segment"],
            "recencyDaysProxy": int(seg_row["recency"]),
            "frequencyProxy": int(seg_row["frequency"]),
            "monetary": float(seg_row["monetary"]),
            "loyaltyTokens": int(seg_row["loyalty_tokens"]),
        },
        "offer": offer,
        "complaints": [complaint_to_dict(c) for c in complaints],
        "outreach": list_actions(session, customer_id),
    }


@router.get("/model/metrics")
def model_metrics(current_user: User = Depends(get_current_user)):
    return get_model_metrics()
