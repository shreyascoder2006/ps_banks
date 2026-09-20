from fastapi import APIRouter, Depends, HTTPException

from ..auth import User, get_current_user
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
def list_segment_customers(segment: str | None = None, current_user: User = Depends(get_current_user)):
    df = compute_segments()
    if segment:
        df = df[df["segment"] == segment]
    out = df[[
        "CustomerId", "Surname", "segment", "recency", "frequency", "monetary",
        "offer_type", "offer_message", "loyalty_tokens",
    ]].rename(columns={"CustomerId": "customerId", "Surname": "surname"})
    return {"count": len(out), "customers": out.to_dict(orient="records")}


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
