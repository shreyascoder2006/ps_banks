"""In-process event bus + WebSocket fan-out.

Every state change in the app (complaint logged/moved, outreach triggered,
outcome recorded, audit hash stored, risk score moved, retrain done) is
published here and pushed to every connected browser, so the UI reacts
without polling. Publishing is fire-and-forget and never raises, so a
disconnected socket can't break a business action.
"""
import asyncio
import json
import threading
from collections import deque
from datetime import datetime
from typing import Any, Optional

_subscribers: set[asyncio.Queue] = set()
_recent: deque = deque(maxlen=200)
_loop: Optional[asyncio.AbstractEventLoop] = None
_lock = threading.Lock()


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def publish(event_type: str, title: str, *, severity: Optional[str] = None, ref: Optional[dict] = None, data: Optional[dict] = None) -> dict:
    event = {
        "type": event_type,
        "title": title,
        "severity": severity,
        "ref": ref or {},
        "data": data or {},
        "at": datetime.utcnow().isoformat() + "Z",
    }
    with _lock:
        _recent.append(event)
        subs = list(_subscribers)
    if _loop is not None:
        for q in subs:
            try:
                _loop.call_soon_threadsafe(q.put_nowait, event)
            except Exception:
                pass
    return event


def recent(limit: int = 50) -> list[dict]:
    with _lock:
        return list(_recent)[-limit:][::-1]


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    with _lock:
        _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    with _lock:
        _subscribers.discard(q)


def serialize(event: dict) -> str:
    return json.dumps(event, default=str)


def subscriber_count() -> int:
    with _lock:
        return len(_subscribers)
