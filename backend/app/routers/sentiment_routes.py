from fastapi import APIRouter, Depends

from ..auth import User, get_current_user
from ..services.market_sentiment import get_market_sentiment_index

router = APIRouter(prefix="/sentiment", tags=["sentiment"])


@router.get("/market")
def market_sentiment(current_user: User = Depends(get_current_user)):
    return get_market_sentiment_index()
