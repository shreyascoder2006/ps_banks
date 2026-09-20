from fastapi import APIRouter, Depends, Query

from ..auth import User, get_current_user
from ..data.loader import load_customers
from ..services.product_trends import get_product_trends

router = APIRouter(prefix="/trends", tags=["trends"])


@router.get("/products")
def product_trends(
    max_tenure: int = Query(default=3, ge=0, le=9),
    geography: str | None = None,
    current_user: User = Depends(get_current_user),
):
    df = load_customers()
    if geography:
        df = df[df["Geography"] == geography]
    return {
        "products": get_product_trends(max_tenure=max_tenure, geography=geography),
        "cohorts": {
            "new": int((df["Tenure"] <= max_tenure).sum()),
            "established": int((df["Tenure"] > max_tenure).sum()),
            "max_tenure": max_tenure,
        },
        "geographies": sorted(load_customers()["Geography"].unique().tolist()),
    }
