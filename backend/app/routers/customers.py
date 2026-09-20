from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import User, get_current_user
from ..services.churn import get_model_metrics, score_all_customers

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
        "isActiveMember": bool(row["Is Active Member"]),
        "lifetimeValue": float(row["lifetime_value"]),
        "churnRiskScore": float(row["churn_risk_score"]),
        "churnRiskLevel": row["churn_risk_level"],
        "churnDrivers": row["churn_drivers"],
        "recommendedAction": row["recommended_action"],
        "lastActiveDaysProxy": int(row["last_active_days_proxy"]),
    }


@router.get("")
def list_customers(
    risk_level: str | None = Query(default=None, alias="riskLevel"),
    branch: str | None = None,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
):
    df = score_all_customers()
    if risk_level:
        df = df[df["churn_risk_level"] == risk_level]
    if branch:
        df = df[df["branch"] == branch]
    df = df.head(limit)
    return {"count": len(df), "customers": [_row_to_dict(r) for _, r in df.iterrows()]}


@router.get("/{customer_id}")
def get_customer(customer_id: int, current_user: User = Depends(get_current_user)):
    df = score_all_customers()
    match = df[df["CustomerId"] == customer_id]
    if match.empty:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _row_to_dict(match.iloc[0])


@router.get("/model/metrics")
def model_metrics(current_user: User = Depends(get_current_user)):
    return get_model_metrics()
