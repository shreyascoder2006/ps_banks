"""Deterministic behavioural feature aggregation over CustomerEvent rows.

Pure functions: given a list of events and an explicit `as_of`, the output is
fully determined (no wall-clock reads), so it is unit-testable and replayable.

Honesty rules:
  - A feature that cannot be computed from the available history is `None`,
    never zero-filled. `sufficiency` says how much to trust the set.
  - The churn dataset has no event history; features only exist for customers
    that have events (ingested feed or labelled simulator/scenario events).
"""
from datetime import datetime, timedelta
from statistics import median
from typing import Iterable, Optional

WINDOWS = (7, 30, 90)
ACTIVITY_TYPES = {"login", "transaction", "salary_credit", "product_usage"}
MIN_EVENTS_OK = 20
MIN_EVENTS_SPARSE = 5
MIN_SPAN_DAYS = 30


def _ts(e) -> datetime:
    return e["event_ts"] if isinstance(e, dict) else e.event_ts


def _get(e, key, default=None):
    return e.get(key, default) if isinstance(e, dict) else getattr(e, key, default)


def _pct_change(recent: float, prior: float) -> Optional[float]:
    if prior is None or prior == 0:
        return None
    return round((recent - prior) / prior * 100, 1)


def _in_window(events: list, as_of: datetime, start_days: int, end_days: int) -> list:
    """Events with as_of - start_days < ts <= as_of - end_days (end_days=0 => up to as_of)."""
    lo, hi = as_of - timedelta(days=start_days), as_of - timedelta(days=end_days)
    return [e for e in events if lo < _ts(e) <= hi]


def _count(events: list, types: Iterable[str]) -> int:
    t = set(types)
    return sum(1 for e in events if _get(e, "event_type") in t)


def _balance_at(events: list, as_of: datetime) -> Optional[float]:
    """Last observed balance_after on or before `as_of`."""
    seen = [e for e in events if _ts(e) <= as_of and _get(e, "balance_after") is not None]
    if not seen:
        return None
    return float(_get(max(seen, key=_ts), "balance_after"))


def compute_features(events: list, as_of: datetime) -> dict:
    """Aggregate rolling-window indicators. Events after `as_of` are ignored."""
    evs = sorted((e for e in events if _ts(e) <= as_of), key=_ts)
    n = len(evs)
    first = _ts(evs[0]) if evs else None
    span_days = (as_of - first).days if first else 0

    if n >= MIN_EVENTS_OK and span_days >= MIN_SPAN_DAYS:
        sufficiency = "ok"
    elif n >= MIN_EVENTS_SPARSE:
        sufficiency = "sparse"
    else:
        sufficiency = "cold_start"

    activity = [e for e in evs if _get(e, "event_type") in ACTIVITY_TYPES]
    last_activity = _ts(activity[-1]) if activity else None
    days_since = round((as_of - last_activity).total_seconds() / 86400, 1) if last_activity else None

    windows = {}
    for w in WINDOWS:
        win = _in_window(evs, as_of, w, 0)
        windows[f"{w}d"] = {
            "events": len(win),
            "logins": _count(win, {"login"}),
            "transactions": _count(win, {"transaction"}),
            "txn_amount": round(sum(abs(_get(e, "amount") or 0) for e in win if _get(e, "event_type") == "transaction"), 2),
            "complaints_logged": _count(win, {"complaint_logged"}),
            "complaints_resolved": _count(win, {"complaint_resolved"}),
        }

    # Recent 30d vs the preceding 30d (days 30-60): the primary "change" comparison.
    cur, prev = _in_window(evs, as_of, 30, 0), _in_window(evs, as_of, 60, 30)
    comparable = span_days >= 60 and len(prev) > 0
    txn_change = _pct_change(_count(cur, {"transaction"}), _count(prev, {"transaction"})) if comparable else None
    login_change = _pct_change(_count(cur, {"login"}), _count(prev, {"login"})) if comparable else None

    bal_now = _balance_at(evs, as_of)
    bal_30 = _balance_at(evs, as_of - timedelta(days=30))
    balance_change = _pct_change(bal_now, bal_30) if (bal_now is not None and bal_30 is not None) else None

    abnormal_moves = 0
    last_bal = None
    for e in _in_window(evs, as_of, 30, 0):
        b = _get(e, "balance_after")
        if b is None:
            continue
        pre = _balance_at(evs, _ts(e) - timedelta(seconds=1))
        if pre and pre > 0 and abs(b - pre) / pre >= 0.30:
            abnormal_moves += 1
        last_bal = b

    # Deviation from the customer's own history: recent 30d weekly txn rate vs days 30-90.
    base_win = _in_window(evs, as_of, 90, 30)
    base_rate = _count(base_win, {"transaction"}) / (60 / 7) if span_days >= 90 else None
    cur_rate = _count(cur, {"transaction"}) / (30 / 7)
    baseline_dev = _pct_change(cur_rate, base_rate) if base_rate else None

    logged_all, resolved_all = _count(evs, {"complaint_logged"}), _count(evs, {"complaint_resolved"})

    return {
        "as_of": as_of.isoformat(),
        "events_total": n,
        "history_span_days": span_days,
        "sufficiency": sufficiency,
        "days_since_last_activity": days_since,
        "windows": windows,
        "txn_change_pct_30d_vs_prev30d": txn_change,
        "login_change_pct_30d_vs_prev30d": login_change,
        "balance_now": bal_now,
        "balance_30d_ago": bal_30,
        "balance_change_pct_30d": balance_change,
        "abnormal_balance_moves_30d": abnormal_moves,
        "unresolved_complaints": max(0, logged_all - resolved_all),
        "baseline_txn_rate_change_pct": baseline_dev,
    }


def peer_deviation(features: dict, peers: list[dict], min_peers: int = 5) -> dict:
    """Compare a customer's 30d activity with the median of a peer cohort's features.
    Returns None values when the cohort is too small to be meaningful."""
    if len(peers) < min_peers:
        return {"peer_count": len(peers), "txn_30d_vs_peer_median_pct": None, "login_30d_vs_peer_median_pct": None}
    out = {"peer_count": len(peers)}
    for key, field in (("txn_30d_vs_peer_median_pct", "transactions"), ("login_30d_vs_peer_median_pct", "logins")):
        med = median(p["windows"]["30d"][field] for p in peers)
        out[key] = _pct_change(features["windows"]["30d"][field], med)
    return out


def signal_overlay(features: dict, inactivity_days: int = 30) -> dict:
    """Map event-derived state onto the two fields the churn model consumes
    (Is Active Member, Balance) via CustomerSignal. This is the documented
    pathway by which new events change a model score. Returns {} when there is
    not enough history to justify overriding the dataset values."""
    if features["sufficiency"] == "cold_start":
        return {}
    out = {}
    d = features["days_since_last_activity"]
    if d is not None:
        out["is_active_member"] = 0 if d >= inactivity_days else 1
    if features["balance_now"] is not None:
        out["balance"] = float(features["balance_now"])
    return out
