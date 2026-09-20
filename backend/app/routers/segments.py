from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import User, get_current_user
from ..services.churn import score_all_customers
from ..services.segmentation import compute_personalised_offer, compute_segments

router = APIRouter(prefix="/segments", tags=["segments"])


@router.get("")
def list_segments(current_user: User = Depends(get_current_user)):
    df = compute_segments()
    summary = (
        df.groupby("segment")
        .agg(count=("CustomerId", "count"), avg_balance=("monetary", "mean"), avg_loyalty_tokens=("loyalty_tokens", "mean"))
        .reset_index()
        .to_dict(orient="records")
    )
    return {"summary": summary}


@router.get("/customers")
def list_segment_customers(
    segment: str | None = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
):
    df = compute_segments()
    scored = score_all_customers()[["CustomerId", "churn_risk_score", "churn_risk_level", "branch"]]
    df = df.merge(scored, on="CustomerId", how="left")
    if segment:
        df = df[df["segment"] == segment]
    total = len(df)
    df = df.sort_values("churn_risk_score", ascending=False).iloc[offset: offset + limit]
    out = df[[
        "CustomerId", "Surname", "segment", "branch", "recency", "frequency", "monetary",
        "offer_type", "loyalty_tokens", "churn_risk_score", "churn_risk_level",
    ]].rename(columns={
        "CustomerId": "customerId", "Surname": "surname", "churn_risk_score": "churnRiskScore",
        "churn_risk_level": "churnRiskLevel", "offer_type": "offerType", "loyalty_tokens": "loyaltyTokens",
    })
    return {"count": len(out), "total": total, "customers": out.to_dict(orient="records")}


@router.get("/impact")
def campaign_impact(
    segment: str,
    win_back_pct: float = Query(default=10, ge=0, le=100),
    current_user: User = Depends(get_current_user),
):
    """What-if for a retention campaign: if `win_back_pct` of the segment's
    critical/high-risk customers are retained, how much balance and how
    many customers are protected. Pure arithmetic over real balances and
    real model scores - no invented uplift assumptions."""
    seg = compute_segments()
    scored = score_all_customers()[["CustomerId", "churn_risk_score", "churn_risk_level"]]
    df = seg.merge(scored, on="CustomerId", how="left")
    df = df[df["segment"] == segment]
    at_risk = df[df["churn_risk_level"].isin(["critical", "high"])]
    n = int(round(len(at_risk) * win_back_pct / 100))
    top = at_risk.sort_values("monetary", ascending=False).head(n)
    return {
        "segment": segment,
        "segmentSize": int(len(df)),
        "atRiskCount": int(len(at_risk)),
        "atRiskBalance": round(float(at_risk["monetary"].sum()), 2),
        "winBackPct": win_back_pct,
        "customersRetained": n,
        "balanceProtected": round(float(top["monetary"].sum()), 2),
        "expectedChurnersAvoided": round(float((top["churn_risk_score"] / 100).sum()), 1),
        "note": "balanceProtected assumes the highest-balance at-risk customers are the ones won back (upper bound).",
    }


@router.get("/{customer_id}/offer")
def customer_offer(customer_id: int, current_user: User = Depends(get_current_user)):
    df = compute_segments()
    match = df[df["CustomerId"] == customer_id]
    if match.empty:
        raise HTTPException(status_code=404, detail="Customer not found")
    row = match.iloc[0]
    offer = compute_personalised_offer(row["recency"], row["frequency"], row["monetary"], row["segment"])
    return {
        "customerId": customer_id,
        "segment": row["segment"],
        "loyaltyTokens": int(row["loyalty_tokens"]),
        **offer,
    }
