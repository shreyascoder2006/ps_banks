from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from app.models import Alert, CustomerEvent, OutreachAction, OutreachOutcome, RiskSnapshot, ScenarioRun
from app.services.retention import actions as act
from app.services.retention import experiments, scenarios


def test_scenario_is_deterministic_and_resets_cleanly(session):
    run = scenarios.start_run(session, "quiet_decline", 7, "tester")
    again = scenarios.start_run(session, "quiet_decline", 7, "tester")
    assert again.run_id == run.run_id  # same seed + same initial state => same customer and run

    results = [scenarios.advance(session, run.run_id, "tester") for _ in range(4)]
    assert results[0]["alertId"] is None  # baseline only
    raised = [r for r in results if r["alertId"]]
    assert len(raised) == 1, "exactly one alert, later evidence is appended rather than duplicated"
    assert results[-1]["suppressed"]["newEvidenceAdded"] is True
    assert any(t["trigger"] == "inactivity" for t in results[-1]["triggers"])
    state = scenarios.get_run(session, run.run_id)
    assert state["simulated"] and all(e["source"] == "simulator" for e in state["events"])
    assert state["currentScore"] > results[0]["score"]
    with pytest.raises(ValueError):
        scenarios.advance(session, run.run_id, "tester")

    # unrelated records survive reset
    other = CustomerEvent(id="keep", customer_id=run.customer_id + 1, event_type="login", event_ts=datetime.utcnow() - timedelta(days=1), source="ingested")
    session.add(other)
    session.commit()
    removed = scenarios.reset_run(session, run.run_id, "tester")["removed"]
    assert removed["events"] > 50 and removed["alerts"] == 1
    assert session.get(CustomerEvent, "keep") is not None
    assert session.exec(select(Alert)).all() == [] and session.exec(select(RiskSnapshot)).all() == []
    assert session.get(ScenarioRun, run.run_id) is None


def test_scenario_replay_generates_identical_events(session):
    run = scenarios.start_run(session, "quiet_decline", 11, "t")
    for _ in range(4):
        scenarios.advance(session, run.run_id, "t")
    first = sorted((e["type"], e["amount"], e["balanceAfter"]) for e in scenarios.get_run(session, run.run_id)["events"])
    scenarios.reset_run(session, run.run_id, "t")
    run2 = scenarios.start_run(session, "quiet_decline", 11, "t")
    for _ in range(4):
        scenarios.advance(session, run2.run_id, "t")
    second = sorted((e["type"], e["amount"], e["balanceAfter"]) for e in scenarios.get_run(session, run2.run_id)["events"])
    assert run2.run_id == run.run_id and first == second


def test_workbench_safeguards_and_lifecycle(session, customer_id):
    r = act.create_recommendation(session, customer_id, "alice", campaign="scenario:t")  # scenario => never holdout
    assert r["created"] and r["action"]["status"] == "recommended" and r["action"]["simulated"]
    dup = act.create_recommendation(session, customer_id, "alice", campaign="scenario:t")
    assert not dup["created"] and any(b["code"] == "duplicate" for b in dup["blocked"])

    aid = r["action"]["id"]
    with pytest.raises(ValueError):
        act.execute_simulated(session, aid, "alice")  # must be approved first
    act.approve(session, aid, "bob", message="Edited text")
    done = act.execute_simulated(session, aid, "bob")
    assert done["status"] == "delivered" and done["simulated"] and "Simulated" in done["notice"]
    row = session.get(OutreachAction, aid)
    assert row.approved_by == "bob" and row.message == "Edited text" and "risk_score" in row.feature_snapshot

    # cooldown now blocks another contact
    blocked = act.check_constraints(session, customer_id, "email", campaign="scenario:t")
    assert any(b["code"] == "cooldown" for b in blocked)


def test_opt_out_blocks_channel(session, customer_id):
    act.set_preferences(session, customer_id, False, ["sms"], "admin")
    assert any(b["code"] == "opt_out_channel" for b in act.check_constraints(session, customer_id, "sms"))
    assert not any(b["code"] == "opt_out_channel" for b in act.check_constraints(session, customer_id, "email"))
    act.set_preferences(session, customer_id, True, [], "admin")
    assert any(b["code"] == "opt_out_all" for b in act.check_constraints(session, customer_id, "call"))


def test_outcome_requires_executed_action_and_keeps_provenance(session, customer_id):
    aid = act.create_recommendation(session, customer_id, "a", campaign="scenario:x")["action"]["id"]
    with pytest.raises(ValueError):
        act.record_observed_outcome(session, aid, "retained", None, "a")  # still only recommended
    act.approve(session, aid, "a")
    act.execute_simulated(session, aid, "a")
    out = act.record_observed_outcome(session, aid, "retained", "called back", "a", source="manual", observed=True)
    assert out["observed"] and out["beforeWindowEnd"] is True
    act.record_observed_outcome(session, aid, "churned", "changed", "a")
    rows = session.exec(select(OutreachOutcome).where(OutreachOutcome.action_id == aid)).all()
    assert len(rows) == 1 and rows[0].outcome == "churned"  # latest wins, no double count


def test_experiment_stats_and_exclusions():
    lo, hi = experiments.wilson(50, 100)
    assert 0.40 < lo < 0.41 and 0.59 < hi < 0.60
    d, dlo, dhi = experiments.newcombe_diff(60, 100, 50, 100)
    assert d == pytest.approx(0.10) and dlo < 0.10 < dhi and dlo < 0 < dhi
    assert experiments.wilson(0, 0) is None


def test_experiment_report_excludes_simulated_and_dedupes(session):
    from app.data.loader import load_customers
    ids = [int(x) for x in load_customers()["CustomerId"].iloc[:6]]
    now = datetime.utcnow()

    def make(cid, group, status, outcome=None, observed=True, days_old=0):
        a = OutreachAction(customer_id=cid, channel="call", offer_type="x", message="m", reason="r", risk_score_at_trigger=70,
                           triggered_by="t", status=status, experiment_group=group, created_at=now - timedelta(days=days_old))
        session.add(a)
        session.commit()
        session.refresh(a)
        if outcome:
            session.add(OutreachOutcome(action_id=a.id, outcome=outcome, observed=observed))
            session.commit()
        return a

    make(ids[0], "treatment", "delivered", "retained")
    make(ids[0], "treatment", "delivered", "churned")  # same customer+campaign: only the latest counts
    make(ids[1], "treatment", "delivered", "retained", observed=False)  # simulated outcome: excluded
    make(ids[2], "treatment", "delivered")  # pending
    make(ids[3], "treatment", "delivered", days_old=45)  # window closed, no outcome => missing
    make(ids[4], "holdout", "withheld", "retained")
    rep = experiments.build_report(session, now=now)
    assert rep["treatment"]["assigned"] == 4
    assert rep["treatment"]["churned"] == 1 and rep["treatment"]["retained"] == 0
    assert rep["treatment"]["pending"] == 2 and rep["treatment"]["missingAfterWindow"] == 1
    assert rep["excludedSimulatedOutcomes"] == 1
    assert rep["holdout"]["retained"] == 1
    assert rep["sampleAdequate"] is False and any("illustrative" in l for l in rep["limitations"])


# ------------------------------------------------------------------ API layer
@pytest.fixture()
def client(session):
    from app.main import app
    return TestClient(app)


def _token(client, user, pw):
    return {"Authorization": "Bearer " + client.post("/auth/login", json={"username": user, "password": pw}).json()["access_token"]}


def test_api_requires_auth_and_roles(client, customer_id):
    assert client.get("/alerts").status_code == 401
    agent, admin = _token(client, "agent", "agent123"), _token(client, "admin", "admin123")
    body = {"customer_id": customer_id, "event_type": "login", "event_ts": (datetime.utcnow() - timedelta(minutes=5)).isoformat(),
            "idempotency_key": "api-test-1"}
    assert client.post("/events", json=body, headers=agent).status_code == 403
    first = client.post("/events", json=body, headers=admin)
    assert first.status_code == 201 and first.json()["created"] is True
    assert client.post("/events", json=body, headers=admin).json()["created"] is False
    assert client.put("/alerts/config", json={"cooldown_hours": 5}, headers=agent).status_code == 403
    cfg = client.put("/alerts/config", json={"critical_score": 9999}, headers=admin).json()["config"]
    assert cfg["critical_score"] == 100  # clamped
    assert client.post("/outreach/retrain", headers=agent).status_code == 403


def test_api_validation(client, customer_id):
    admin = _token(client, "admin", "admin123")
    bad = {"customer_id": customer_id, "event_type": "teleport", "event_ts": datetime.utcnow().isoformat()}
    assert client.post("/events", json=bad, headers=admin).status_code == 422
    future = {"customer_id": customer_id, "event_type": "login", "event_ts": (datetime.utcnow() + timedelta(days=5)).isoformat()}
    assert client.post("/events", json=future, headers=admin).status_code == 422
    assert client.post("/events", json={**future, "customer_id": 1}, headers=admin).status_code == 404


def test_api_scenario_to_outcome_chain(client):
    h = _token(client, "agent", "agent123")
    run = client.post("/scenarios/runs", json={"seed": 3}, headers=h).json()
    for _ in range(4):
        assert client.post(f"/scenarios/runs/{run['runId']}/step", headers=h).status_code == 200
    alerts = client.get("/alerts?status=active", headers=h).json()
    assert alerts["total"] >= 1
    alert = alerts["alerts"][0]
    assert alert["simulated"] is True
    detail = client.get(f"/alerts/{alert['id']}", headers=h).json()
    assert detail["evidence"]["features"] and detail["history"]
    assert client.post(f"/alerts/{alert['id']}/status", json={"status": "resolved"}, headers=h).status_code == 409  # reason needed
    rec = client.post("/workbench/recommend", json={"customer_id": alert["customerId"], "alert_id": alert["id"]}, headers=h)
    assert rec.status_code == 201
    aid = rec.json()["action"]["id"]
    assert rec.json()["action"]["campaign"].startswith("scenario:")
    assert client.post(f"/workbench/actions/{aid}/approve", json={}, headers=h).status_code == 200
    ex = client.post(f"/workbench/actions/{aid}/execute", headers=h).json()
    assert ex["simulated"] is True
    out = client.post(f"/workbench/actions/{aid}/outcome", json={"outcome": "retained"}, headers=h).json()
    assert out["observed"] is False  # scenario outcomes are never counted as observed
    ov = client.get("/dashboard/overview", headers=h).json()
    assert ov["kpis"]["monitored"] > 0 and ov["signals"]["simulatedEvents"] > 0
    assert ov["retention"]["experiment"]["treatment"]["measured"] == 0
    assert client.get(f"/customers/{alert['customerId']}/timeline", headers=h).json()["items"]
    assert client.delete(f"/scenarios/runs/{run['runId']}", headers=h).status_code == 200
    assert client.get("/alerts", headers=h).json()["total"] == 0


def test_model_health_reports_limitations(client):
    h = _token(client, "agent", "agent123")
    mh = client.get("/model/health", headers=h).json()
    assert mh["calibrated"] is False and mh["limitations"] and mh["metrics"]["auc"] > 0.7
    assert {"tn", "fp", "fn", "tp"} <= set(mh["confusion"])
    assert mh["drift"] and all("psi" in d for d in mh["drift"])
