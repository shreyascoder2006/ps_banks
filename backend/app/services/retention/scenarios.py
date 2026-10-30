"""Scenario Studio: deterministic, clearly-simulated customer journeys.

Every event carries source="simulator" and scenario_run=<run id>. Given the same
seed and the same initial state the same customer is chosen and the same events
are generated. Reset removes only records tagged with the run.
"""
import json
import random
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from ...models import (Alert, AlertHistory, CustomerEvent, CustomerSignal, OutreachAction, OutreachOutcome,
                       RiskSnapshot, ScenarioRun)
from ...data.loader import load_customers
from ..churn import invalidate_scoring_cache, score_all_customers
from .alerts import alert_to_dict, evaluate_customer
from .event_store import audit, event_to_dict, events_for, ingest_event
from .features import compute_features

SCENARIOS = {
    "quiet_decline": {
        "name": "The quiet decline",
        "description": "A previously active customer stops logging in, moves most of their balance out and then complains. "
                       "The feature pipeline detects each change, the model re-scores, and an early-warning alert is raised.",
        "steps": [
            {"label": "Healthy baseline", "day": 0, "detail": "90 days of normal logins, transactions and salary credits are loaded."},
            {"label": "Digital activity fades", "day": 10, "detail": "Logins stop; transaction frequency falls."},
            {"label": "Large balance outflow", "day": 21, "detail": "Balance drops by about half in one transfer."},
            {"label": "Complaints and silence", "day": 42, "detail": "Two complaints are logged; 30+ days without activity."},
        ],
    },
}
ANCHOR_DAYS = 42


def list_scenarios() -> list[dict]:
    return [{"id": k, **v} for k, v in SCENARIOS.items()]


def _pick_customer(session: Session, seed: int) -> int:
    df = score_all_customers()
    taken = {r.customer_id for r in session.exec(select(ScenarioRun)).all()}
    with_signal = {s.customer_id for s in session.exec(select(CustomerSignal)).all()}
    with_events = {e.customer_id for e in session.exec(select(CustomerEvent)).all()}
    cand = df[(df["Is Active Member"] == 1) & (df["Balance"] >= 30000) & (df["churn_risk_score"] >= 30)
              & ~df["CustomerId"].isin(taken | with_signal | with_events)].sort_values("CustomerId")
    if cand.empty:
        raise RuntimeError("no suitable customer available for a scenario")
    return int(cand.iloc[random.Random(seed).randrange(len(cand))]["CustomerId"])


def start_run(session: Session, scenario: str, seed: int, actor: str) -> ScenarioRun:
    if scenario not in SCENARIOS:
        raise KeyError(scenario)
    prior = session.exec(select(ScenarioRun).where(ScenarioRun.scenario == scenario, ScenarioRun.seed == seed)).first()
    if prior:
        return prior  # same scenario + seed is one run until it is reset
    anchor = datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=0) - timedelta(days=ANCHOR_DAYS)
    cid = _pick_customer(session, seed)
    run = ScenarioRun(run_id=f"{scenario}-{seed}-{cid}", scenario=scenario, seed=seed, customer_id=cid, step=0,
                      created_by=actor, anchor=anchor)
    existing = session.get(ScenarioRun, run.run_id)
    if existing:
        return existing
    session.add(run)
    audit(session, actor, "scenario_started", run.run_id, {"customer": cid, "seed": seed})
    session.commit()
    session.refresh(run)
    return run


def _events_for_step(run: ScenarioRun, step: int, balance: float) -> list[dict]:
    rng = random.Random(run.seed * 1000 + step)
    a = run.anchor
    out = []

    def add(day, etype, hour=10, **kw):
        out.append({"type": etype, "ts": a + timedelta(days=day, hours=hour - 9, minutes=rng.randrange(0, 50)), **kw})

    if step == 1:
        salary = round(balance * 0.35, 2)
        for d in range(-90, 1):
            if d % 2 == 0 and rng.random() < 0.9:
                add(d, "login", channel="mobile")
            if d % 2 == 1 and rng.random() < 0.75:
                add(d, "transaction", amount=round(rng.uniform(300, 4000), 2), channel="upi", balance_after=round(balance * rng.uniform(0.97, 1.03), 2))
            if d in (-60, -30, 0):
                add(d, "salary_credit", amount=salary, balance_after=round(balance, 2))
            if d % 7 == 0:
                add(d, "product_usage", channel="net_banking")
    elif step == 2:
        add(3, "login", channel="mobile")
        add(6, "transaction", amount=round(rng.uniform(300, 2500), 2), channel="upi", balance_after=round(balance * 0.97, 2))
        add(10, "transaction", amount=round(rng.uniform(300, 2500), 2), channel="upi", balance_after=round(balance * 0.95, 2))
    elif step == 3:
        add(20, "balance_change", amount=-round(balance * 0.45, 2), balance_after=round(balance * 0.5, 2), channel="neft",
            metadata={"note": "large outbound transfer"})
    elif step == 4:
        add(34, "complaint_logged", channel="branch", metadata={"subject": "Card blocked without notice"})
        add(40, "complaint_logged", channel="ivr", metadata={"subject": "Follow-up: no response from branch"})
    return out


def advance(session: Session, run_id: str, actor: str) -> dict:
    run = session.get(ScenarioRun, run_id)
    if not run:
        raise KeyError(run_id)
    meta = SCENARIOS[run.scenario]
    if run.step >= len(meta["steps"]):
        raise ValueError("scenario already complete")
    step = run.step + 1
    base_balance = float(load_customers().set_index("CustomerId").loc[run.customer_id, "Balance"])  # dataset value, unaffected by overlays
    created = []
    for i, e in enumerate(_events_for_step(run, step, base_balance)):
        ev, was_new = ingest_event(
            session, customer_id=run.customer_id, event_type=e["type"], event_ts=e["ts"], source="simulator", channel=e.get("channel"),
            amount=e.get("amount"), balance_after=e.get("balance_after"), metadata={**(e.get("metadata") or {}), "step": step},
            idempotency_key=f"{run.run_id}:{step}:{i}", scenario_run=run.run_id,
        )
        if was_new:
            created.append(event_to_dict(ev))
    as_of = run.anchor + timedelta(days=meta["steps"][step - 1]["day"], hours=1)
    ev_result = evaluate_customer(session, run.customer_id, as_of=as_of, actor="scenario", scenario_run=run.run_id)
    run.step = step
    session.add(run)
    audit(session, actor, "scenario_step", run.run_id, {"step": step, "events": len(created)})
    session.commit()
    return {"runId": run.run_id, "step": step, "label": meta["steps"][step - 1]["label"], "asOf": as_of.isoformat() + "Z",
            "newEvents": created, "score": ev_result["score"], "previousScore": ev_result["previousScore"],
            "triggers": ev_result["triggers"], "alertId": ev_result["created"], "suppressed": ev_result["suppressed"],
            "features": ev_result["features"]}


def get_run(session: Session, run_id: str) -> dict:
    run = session.get(ScenarioRun, run_id)
    if not run:
        raise KeyError(run_id)
    meta = SCENARIOS[run.scenario]
    evs = [e for e in events_for(session, run.customer_id) if e.scenario_run == run.run_id]
    snaps = list(session.exec(select(RiskSnapshot).where(RiskSnapshot.scenario_run == run.run_id).order_by(RiskSnapshot.at)).all())
    alerts = list(session.exec(select(Alert).where(Alert.scenario_run == run.run_id)).all())
    steps = []
    for i, s in enumerate(meta["steps"], 1):
        as_of = run.anchor + timedelta(days=s["day"], hours=1)
        done = i <= run.step
        steps.append({**s, "index": i, "done": done, "asOf": as_of.isoformat() + "Z",
                      "features": compute_features(evs, as_of) if done else None})
    df = score_all_customers().set_index("CustomerId")
    row = df.loc[run.customer_id]
    return {
        "runId": run.run_id, "scenario": run.scenario, "name": meta["name"], "seed": run.seed, "customerId": run.customer_id,
        "surname": row["Surname"], "branch": row["branch"], "step": run.step, "totalSteps": len(meta["steps"]),
        "complete": run.step >= len(meta["steps"]), "steps": steps, "simulated": True,
        "events": [event_to_dict(e) for e in evs[-60:]], "eventCount": len(evs),
        "scores": [{"at": s.at.isoformat() + "Z", "score": s.score, "level": s.level} for s in snaps],
        "currentScore": float(row["churn_risk_score"]), "currentLevel": row["churn_risk_level"],
        "alerts": [alert_to_dict(a) for a in alerts],
    }


def reset_run(session: Session, run_id: str, actor: str) -> dict:
    run = session.get(ScenarioRun, run_id)
    if not run:
        raise KeyError(run_id)
    removed = {}
    for model, key in ((CustomerEvent, "events"), (RiskSnapshot, "snapshots")):
        rows = session.exec(select(model).where(model.scenario_run == run_id)).all()
        removed[key] = len(rows)
        for r in rows:
            session.delete(r)
    alerts = session.exec(select(Alert).where(Alert.scenario_run == run_id)).all()
    removed["alerts"] = len(alerts)
    for a in alerts:
        for h in session.exec(select(AlertHistory).where(AlertHistory.alert_id == a.id)).all():
            session.delete(h)
        session.delete(a)
    actions = session.exec(select(OutreachAction).where(OutreachAction.campaign == f"scenario:{run_id}")).all()
    removed["outreach"] = len(actions)
    for a in actions:
        for o in session.exec(select(OutreachOutcome).where(OutreachOutcome.action_id == a.id)).all():
            session.delete(o)
        session.delete(a)
    sig = session.get(CustomerSignal, run.customer_id)
    if sig and sig.source == "simulator" and (sig.note or "").startswith("Derived from"):
        session.delete(sig)
        removed["signal_override"] = 1
    session.delete(run)
    audit(session, actor, "scenario_reset", run_id, removed)
    session.commit()
    invalidate_scoring_cache()
    return {"runId": run_id, "removed": removed}
