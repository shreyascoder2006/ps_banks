"""Repurposed "Competitive AI Index" -> Banking Market Sentiment Index.

Same structure as the original `model/competitive_index.py` (Google Trends
+ stock movement + VADER sentiment blended into a 0-100 score), but the
keywords/tickers are swapped for banking-relevant ones, and every signal
has an explicit graceful fallback with a `source` tag so the frontend can
show whether a number is live or a fallback default (per the "no silent
fabrication" rule: never present a fallback number as if it were live data).
"""
from typing import Dict, List

try:
    from pytrends.request import TrendReq
    PYTRENDS_AVAILABLE = True
except ImportError:
    PYTRENDS_AVAILABLE = False

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    VADER_AVAILABLE = True
except ImportError:
    VADER_AVAILABLE = False


BANKING_KEYWORDS = ["fixed deposit rates", "home loan interest rate", "UPI fraud", "bank net banking down"]
BANKING_TICKERS = ["HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS"]

# Canned banking-relevant headlines used for the sentiment leg when no live
# news API key is configured. This is a documented placeholder, not live
# news - see LIMITATIONS.md.
_FALLBACK_HEADLINES = [
    "Bank reports steady growth in digital transactions this quarter.",
    "Customers flag delays in UPI transaction settlement.",
    "RBI tightens KYC norms for savings accounts.",
    "New fixed deposit rates offer higher returns for senior citizens.",
    "Complaints about ATM downtime rise in urban branches.",
]


def _trends_score(fallback: float = 50.0) -> Dict:
    if not PYTRENDS_AVAILABLE:
        return {"score": fallback, "source": "fallback", "detail": "pytrends not installed"}
    try:
        pytrends = TrendReq(hl="en-IN", tz=330)
        pytrends.build_payload(BANKING_KEYWORDS[:3], timeframe="now 7-d")
        data = pytrends.interest_over_time()
        if data.empty:
            return {"score": fallback, "source": "fallback", "detail": "no data returned"}
        avg = float(data[BANKING_KEYWORDS[:3]].mean().mean())
        return {"score": round(avg, 1), "source": "live", "detail": "Google Trends 7-day avg interest"}
    except Exception as exc:
        return {"score": fallback, "source": "fallback", "detail": f"pytrends error: {exc}"}


def _market_score(fallback: float = 50.0) -> Dict:
    if not YFINANCE_AVAILABLE:
        return {"score": fallback, "source": "fallback", "detail": "yfinance not installed"}
    try:
        changes = []
        for ticker in BANKING_TICKERS:
            hist = yf.Ticker(ticker).history(period="5d")
            if len(hist) >= 2:
                pct = (hist["Close"].iloc[-1] - hist["Close"].iloc[0]) / hist["Close"].iloc[0] * 100
                changes.append(pct)
        if not changes:
            return {"score": fallback, "source": "fallback", "detail": "no ticker data returned"}
        avg_change = sum(changes) / len(changes)
        score = max(0, min(100, 50 + avg_change * 5))
        return {"score": round(score, 1), "source": "live", "detail": f"avg 5d change {round(avg_change, 2)}% across {len(changes)} bank stocks"}
    except Exception as exc:
        return {"score": fallback, "source": "fallback", "detail": f"yfinance error: {exc}"}


def _sentiment_score(headlines: List[str] = None) -> Dict:
    headlines = headlines or _FALLBACK_HEADLINES
    if not VADER_AVAILABLE:
        return {"score": 50.0, "source": "fallback", "detail": "vaderSentiment not installed"}
    analyzer = SentimentIntensityAnalyzer()
    compounds = [analyzer.polarity_scores(h)["compound"] for h in headlines]
    avg = sum(compounds) / len(compounds) if compounds else 0.0
    score = round((avg + 1) / 2 * 100, 1)  # map [-1,1] -> [0,100]
    source = "live" if headlines is not _FALLBACK_HEADLINES else "fallback"
    return {"score": score, "source": source, "detail": f"VADER on {len(headlines)} headlines ({'canned' if source == 'fallback' else 'supplied'})"}


def get_market_sentiment_index() -> dict:
    trends = _trends_score()
    market = _market_score()
    sentiment = _sentiment_score()

    composite = round((trends["score"] + market["score"] + sentiment["score"]) / 3, 1)

    return {
        "composite_score": composite,
        "components": {
            "search_interest": trends,
            "banking_stocks": market,
            "news_sentiment": sentiment,
        },
        "note": "Any component tagged source=fallback is a documented placeholder default, not a live signal - see LIMITATIONS.md.",
    }
