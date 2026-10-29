from fastapi import APIRouter
from ..services.forecast import get_customer_growth_forecast

router = APIRouter(prefix="/forecast", tags=["forecast"])


@router.get("/growth")
def growth_forecast(periods: int = 3):
    return get_customer_growth_forecast(periods=periods)
