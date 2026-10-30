from datetime import datetime, timedelta

from app.services.retention.features import compute_features, peer_deviation, signal_overlay

NOW = datetime(2026, 6, 30, 12, 0, 0)


def ev(days_ago, etype="transaction", amount=100.0, balance=None):
    return {"event_type": etype, "event_ts": NOW - timedelta(days=days_ago), "amount": amount, "balance_after": balance}


def test_empty_history_is_cold_start_and_none_not_zero():
    f = compute_features([], NOW)
    assert f["sufficiency"] == "cold_start"
    assert f["days_since_last_activity"] is None
    assert f["txn_change_pct_30d_vs_prev30d"] is None
    assert f["balance_change_pct_30d"] is None
    assert signal_overlay(f) == {}


def test_rolling_windows_are_explicit_and_ignore_future():
    events = [ev(1), ev(3), ev(10), ev(40), ev(80), ev(-5)]  # last one is in the future
    f = compute_features(events, NOW)
    assert f["windows"]["7d"]["transactions"] == 2
    assert f["windows"]["30d"]["transactions"] == 3
    assert f["windows"]["90d"]["transactions"] == 5
    assert f["events_total"] == 5


def test_activity_change_needs_60_days_of_history():
    recent = [ev(d) for d in range(1, 11)]
    assert compute_features(recent, NOW)["txn_change_pct_30d_vs_prev30d"] is None
    history = recent + [ev(d) for d in (35, 40, 45, 50, 55, 58, 59, 70)]
    f = compute_features(history, NOW)
    assert f["txn_change_pct_30d_vs_prev30d"] == round((10 - 7) / 7 * 100, 1)


def test_inactivity_and_balance_decline():
    events = [ev(60, balance=100000), ev(45, "login"), ev(35, balance=95000), ev(2, "balance_change", amount=-50000, balance=40000)]
    f = compute_features(events, NOW)
    assert f["balance_now"] == 40000
    assert f["balance_30d_ago"] == 95000
    assert f["balance_change_pct_30d"] == round((40000 - 95000) / 95000 * 100, 1)
    assert f["abnormal_balance_moves_30d"] == 1


def test_days_since_last_activity_ignores_non_activity_events():
    events = [ev(10, "login"), ev(2, "complaint_logged")]
    assert compute_features(events, NOW)["days_since_last_activity"] == 10.0


def test_unresolved_complaint_burden():
    events = [ev(5, "complaint_logged"), ev(4, "complaint_logged"), ev(2, "complaint_resolved")]
    f = compute_features(events, NOW)
    assert f["unresolved_complaints"] == 1
    assert f["windows"]["30d"]["complaints_logged"] == 2


def test_features_are_deterministic_and_order_independent():
    events = [ev(d) for d in range(0, 100, 3)]
    assert compute_features(events, NOW) == compute_features(list(reversed(events)), NOW)


def test_peer_deviation_requires_enough_peers():
    f = compute_features([ev(d) for d in range(1, 9)], NOW)
    assert peer_deviation(f, [f] * 3)["txn_30d_vs_peer_median_pct"] is None
    peers = [compute_features([ev(d) for d in range(1, 5)], NOW)] * 5
    assert peer_deviation(f, peers)["txn_30d_vs_peer_median_pct"] == 100.0


def test_overlay_marks_inactive_after_threshold():
    events = [ev(d, "login", balance=5000) for d in (40, 45, 50, 55, 60, 65)]
    f = compute_features(events, NOW)
    assert signal_overlay(f, inactivity_days=30)["is_active_member"] == 0
    assert signal_overlay(f, inactivity_days=60)["is_active_member"] == 1
