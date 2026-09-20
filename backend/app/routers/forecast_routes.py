from fastapi import APIRouter, Depends

from ..auth import User, get_current_user
from ..services.forecast import get_customer_growth_forecast

router = APIRouter(prefix="/forecast", tags=["forecast"])


@router.get("/growth")
def growth_forecast(periods: int = 3, current_user: User = Depends(get_current_user)):
    return get_customer_growth_forecast(periods=periods)
