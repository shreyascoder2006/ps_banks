from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import User, get_current_user
from ..services.market_sentiment import _sentiment_score, get_market_sentiment_index

router = APIRouter(prefix="/sentiment", tags=["sentiment"])


class HeadlinesRequest(BaseModel):
    headlines: list[str]


@router.get("/market")
def market_sentiment(current_user: User = Depends(get_current_user)):
    return get_market_sentiment_index()


@router.post("/headlines")
def score_headlines(body: HeadlinesRequest, current_user: User = Depends(get_current_user)):
    """Score user-supplied headlines with VADER so the news leg becomes a
    genuinely live signal instead of the canned fallback set."""
    cleaned = [h.strip() for h in body.headlines if h.strip()]
    if not cleaned:
        return {"score": None, "source": "none", "detail": "no headlines supplied", "per_headline": []}
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        analyzer = SentimentIntensityAnalyzer()
        per = [{"headline": h, "compound": round(analyzer.polarity_scores(h)["compound"], 3)} for h in cleaned]
    except ImportError:
        per = []
    overall = _sentiment_score(cleaned)
    return {**overall, "per_headline": per}
