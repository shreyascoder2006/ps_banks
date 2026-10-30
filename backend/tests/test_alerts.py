from datetime import datetime, timedelta

import pytest
from sqlmodel import select

from app.models import Alert
from app.services.retention import alerts as al
from app.services.retention.event_store import ingest_event

NOW = datetime(2026, 6, 30, 12, 0, 0)
CFG = al.AlertConfig(min_score_for_behaviour_alert=0)


def seed_inactive_history(session, cid, run="t1"):
    for i, d in enumerate([60, 55, 50, 48, 46, 44, 42]):
        ingest_event(session, customer_id=cid, event_type="login", event_ts=NOW - timedelta(days=d), source="simulator",
                     balance_after=90000, idempotency_key=f"{cid}-{run}-{i}", scenario_run=run, now=NOW)


def test_ingest_is_idempotent(session, customer_id):
    a, created_a = ingest_event(session, customer_id=customer_id, event_type="login", event_ts=NOW, idempotency_key="k1", now=NOW)
    b, created_b = ingest_event(session, customer_id=customer_id, event_type="login", event_ts=NOW, idempotency_key="k1", now=NOW)
    assert created_a and not created_b and a.id == b.id


def test_ingest_rejects_bad_input(session, customer_id):
    with pytest.raises(ValueError):
        ingest_event(session, customer_id=customer_id, event_type="nope", event_ts=NOW, now=NOW)
    with pytest.raises(ValueError):
        ingest_event(session, customer_id=customer_id, event_type="login", event_ts=NOW + timedelta(days=3), now=NOW)


def test_late_events_are_flagged(session, customer_id):
    ev, _ = ingest_event(session, customer_id=customer_id, event_type="login", event_ts=NOW - timedelta(days=5), now=NOW)
    assert ev.quality == "late"


def test_first_evaluation_is_baseline_only(session, customer_id):
    r = al.evaluate_customer(session, customer_id, as_of=NOW)
    assert r["baselineEstablished"] and r["created"] is None
    assert session.exec(select(Alert)).all() == []


def test_inactivity_creates_one_deduplicated_alert(session, customer_id):
    seed_inactive_history(session, customer_id)
    first = al.evaluate_customer(session, customer_id, as_of=NOW, cfg=CFG, scenario_run="t1")
    assert first["created"]
    assert any(t["trigger"] == "inactivity" for t in first["triggers"])
    second = al.evaluate_customer(session, customer_id, as_of=NOW + timedelta(hours=1), cfg=CFG, scenario_run="t1")
    assert second["created"] is None and second["suppressed"]["reason"] == "active_alert_exists"
    assert len(session.exec(select(Alert)).all()) == 1


def test_alert_stores_evidence_and_provenance(session, customer_id):
    seed_inactive_history(session, customer_id)
    aid = al.evaluate_customer(session, customer_id, as_of=NOW, cfg=CFG, scenario_run="t1")["created"]
    d = al.alert_to_dict(session.get(Alert, aid), history=[])
    assert d["simulated"] and d["dataSource"] == "simulator"
    assert d["evidence"]["features"]["days_since_last_activity"] >= 30
    assert d["explanation"][0]["text"]


def test_cooldown_after_resolution(session, customer_id):
    seed_inactive_history(session, customer_id)
    aid = al.evaluate_customer(session, customer_id, as_of=NOW, cfg=CFG, scenario_run="t1")["created"]
    al.transition(session, aid, "resolved", "tester", "handled")
    again = al.evaluate_customer(session, customer_id, as_of=NOW + timedelta(hours=2), cfg=CFG, scenario_run="t1")
    assert again["created"] is None and again["suppressed"]["reason"] == "cooldown"
    later = al.evaluate_customer(session, customer_id, as_of=NOW + timedelta(hours=30), cfg=CFG, scenario_run="t1")
    assert later["created"] is not None


def test_status_workflow_and_required_reason(session, customer_id):
    seed_inactive_history(session, customer_id)
    aid = al.evaluate_customer(session, customer_id, as_of=NOW, cfg=CFG, scenario_run="t1")["created"]
    al.transition(session, aid, "acknowledged", "alice")
    with pytest.raises(ValueError):
        al.transition(session, aid, "resolved", "alice")  # reason required
    with pytest.raises(ValueError):
        al.transition(session, aid, "open", "alice")  # not allowed from acknowledged
    a = al.transition(session, aid, "dismissed", "alice", "false positive")
    assert a.status == "dismissed" and a.resolution_reason == "false positive"
    assert al.transition(session, aid, "open", "bob").status == "open"


def test_config_is_clamped():
    cfg = al.validate(al.AlertConfig(critical_score=500, high_score=90, risk_jump_points=0, cooldown_hours=-4))
    assert cfg.critical_score == 100 and cfg.high_score < cfg.critical_score
    assert cfg.risk_jump_points == 3 and cfg.cooldown_hours == 0
