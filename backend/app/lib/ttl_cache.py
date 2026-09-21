"""Tiny TTL memoization decorator.

score_all_customers() re-runs RandomForest.predict_proba on all 10,000
rows plus 4 DB round trips on every call, with no caching at all - nearly
every page load pays that twice. External calls (Gemini, pytrends,
yfinance) are similarly re-fetched on every request. A short TTL keeps
data feeling live (it's invalidated by any write anyway via events) while
cutting repeat-request latency to near zero.
"""
import time
from functools import wraps


def ttl_cache(seconds: float):
    def decorator(fn):
        store: dict = {}

        @wraps(fn)
        def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            now = time.monotonic()
            hit = store.get(key)
            if hit is not None and now - hit[0] < seconds:
                return hit[1]
            result = fn(*args, **kwargs)
            store[key] = (now, result)
            return result

        wrapper.cache_clear = lambda: store.clear()
        return wrapper
    return decorator
