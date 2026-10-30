"""Retention workflow API: events, features, alerts, workbench, experiments, model health, scenarios."""
from dataclasses import asdict
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..auth import User, get_current_user, require_admin
from ..db import get_session
from ..models import Alert, AlertHistory, AuditLog, CustomerEvent
from ..services.churn import score_all_customers
from ..services.retention import actions as act
from ..services.retention import alerts as al
from ..services.retention import dashboard, experiments, model_health, scenarios
from ..services.retention.event_store import EVENT_TYPES, audit, event_to_dict, events_for, ingest_event
from ..services.retention.features import compute_features

router = APIRouter(tags=["retention"])


def _need_customer(customer_id: int) -> None:
    if score_all_customers()[lambda d: d["CustomerId"] == customer_id].empty:
        raise HTTPException(status_code=404, detail="Customer not found")


# ---------------------------------------------------------------- events
class EventIn(BaseModel):
    customer_id: int = Field(gt=0)
    event_type: str
    event_ts: datetime
    channel: Optional[str] = Field(default=None, max_length=40)
    branch: Optional[str] = Field(default=None, max_length=60)
    amount: Optional[float] = Field(default=None, ge=-1e9, le=1e9)
    balance_after: Optional[float] = Field(default=None, ge=-1e9, le=1e9)
    metadata: Optional[dict] = None
    idempotency_key: Optional[str] = Field(default=None, min_length=4, max_length=120)


@router.post("/events", status_code=201)
def post_event(body: EventIn, session: Session = Depends(get_session), user: User = Depends(require_admin)):
    """Ingest one real (non-simulated) behavioural event. Admin only; idempotent on idempotency_key."""
    _need_customer(body.customer_id)
    try:
        ev, created = ingest_event(session, customer_id=body.customer_id, event_type=body.event_type, event_ts=body.event_ts,
                                   source="ingested", channel=body.channel, branch=body.branch, amount=body.amount,
                                   balance_after=body.balance_after, metadata=body.metadata, idempotency_key=body.idempotency_key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    audit(session, user.username, "event_ingested" if created else "event_duplicate_ignored", ev.id, {"customer": body.customer_id})
    session.commit()
    return {"created": created, "event": event_to_dict(ev)}


@router.get("/events/types")
def event_types(user: User = Depends(get_current_user)):
    return {"types": list(EVENT_TYPES)}


@router.get("/customers/{customer_id}/features")
def customer_features(customer_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _need_customer(customer_id)
    f = compute_features(events_for(session, customer_id), datetime.utcnow())
    return {"customerId": customer_id, "features": f,
            "provenance": "Computed from CustomerEvent rows only. The source churn dataset has no event history, so most customers are cold_start."}


@router.get("/customers/{customer_id}/timeline")
def customer_timeline(customer_id: int, limit: int = Query(default=100, ge=1, le=500), session: Session = Depends(get_session),
                      user: User = Depends(get_current_user)):
    _need_customer(customer_id)
    return {"customerId": customer_id, "items": dashboard.timeline(session, customer_id, limit)}


@router.get("/customers/{customer_id}/risk-history")
def risk_history(customer_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    from ..models import RiskSnapshot
    rows = session.exec(select(RiskSnapshot).where(RiskSnapshot.customer_id == customer_id).order_by(RiskSnapshot.at)).all()
    return {"customerId": customer_id, "points": [{"at": r.at.isoformat() + "Z", "score": r.score, "level": r.level, "source": r.source} for r in rows]}


# ---------------------------------------------------------------- alerts
class StatusIn(BaseModel):
    status: str
    note: Optional[str] = Field(default=None, max_length=1000)


class AssignIn(BaseModel):
    assignee: str = Field(min_length=1, max_length=60)


class NoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=1000)


class ConfigIn(BaseModel):
    critical_score: Optional[float] = None
    high_score: Optional[float] = None
    risk_jump_points: Optional[float] = None
    inactivity_days: Optional[int] = None
    balance_decline_pct: Optional[float] = None
    complaint_spike_30d: Optional[int] = None
    cooldown_hours: Optional[int] = None
    min_score_for_behaviour_alert: Optional[float] = None


@router.get("/alerts")
def get_alerts(status: Optional[str] = None, severity: Optional[str] = None, q: Optional[str] = Query(default=None, max_length=60),
               sort: str = "severity", include_simulated: bool = True, limit: int = Query(default=50, ge=1, le=200),
               offset: int = Query(default=0, ge=0), session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return al.list_alerts(session, status=status, severity=severity, q=q, sort=sort, include_simulated=include_simulated, limit=limit, offset=offset)


@router.get("/alerts/summary")
def alerts_summary(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return al.alert_counts(session)


@router.get("/alerts/config")
def alerts_config(user: User = Depends(get_current_user)):
    return {"config": asdict(al.get_config()), "bounds": al._BOUNDS}


@router.put("/alerts/config")
def put_alerts_config(body: ConfigIn, session: Session = Depends(get_session), user: User = Depends(require_admin)):
    cfg = al.update_config(body.model_dump(exclude_none=True))
    audit(session, user.username, "alert_config_changed", "alert-config", body.model_dump(exclude_none=True))
    session.commit()
    return {"config": asdict(cfg)}


@router.post("/alerts/evaluate/{customer_id}")
def evaluate(customer_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _need_customer(customer_id)
    r = al.evaluate_customer(session, customer_id, actor=user.username)
    r.pop("features", None)
    return r


@router.get("/alerts/{alert_id}")
def get_alert(alert_id: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    a = session.get(Alert, alert_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    hist = session.exec(select(AlertHistory).where(AlertHistory.alert_id == alert_id).order_by(AlertHistory.at)).all()
    return al.alert_to_dict(a, score_all_customers().set_index("CustomerId"), hist)


def _alert_action(fn):
    try:
        return fn()
    except KeyError:
        raise HTTPException(status_code=404, detail="Alert not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/alerts/{alert_id}/status")
def alert_status(alert_id: str, body: StatusIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    a = _alert_action(lambda: al.transition(session, alert_id, body.status, user.username, body.note))
    return al.alert_to_dict(a)


@router.post("/alerts/{alert_id}/assign")
def alert_assign(alert_id: str, body: AssignIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return al.alert_to_dict(_alert_action(lambda: al.assign(session, alert_id, body.assignee, user.username)))


@router.post("/alerts/{alert_id}/notes")
def alert_note(alert_id: str, body: NoteIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _alert_action(lambda: al.add_note(session, alert_id, user.username, body.note))
    return {"ok": True}


# ---------------------------------------------------------------- workbench
class RecommendIn(BaseModel):
    customer_id: int = Field(gt=0)
    channel: Optional[str] = None
    message: Optional[str] = Field(default=None, max_length=2000)
    alert_id: Optional[str] = Field(default=None, max_length=20)


class ApproveIn(BaseModel):
    message: Optional[str] = Field(default=None, max_length=2000)
    channel: Optional[str] = None


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class OutcomeIn(BaseModel):
    outcome: str
    notes: Optional[str] = Field(default=None, max_length=1000)


class PrefIn(BaseModel):
    opt_out_all: bool = False
    opt_out_channels: list[str] = []


def _wrap(fn):
    try:
        return fn()
    except KeyError:
        raise HTTPException(status_code=404, detail="Not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/workbench/options/{customer_id}")
def workbench_options(customer_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _need_customer(customer_id)
    return act.rank_options(session, customer_id)


@router.get("/workbench/actions")
def workbench_actions(status: Optional[str] = None, campaign: Optional[str] = None, session: Session = Depends(get_session),
                      user: User = Depends(get_current_user)):
    return {"actions": act.list_workbench(session, status, campaign), "cooldownDays": act.COOLDOWN_DAYS,
            "maxContacts30d": act.MAX_CONTACTS_30D, "holdoutPct": act.HOLDOUT_PCT}


@router.post("/workbench/recommend", status_code=201)
def workbench_recommend(body: RecommendIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _need_customer(body.customer_id)
    campaign = "retention-v1"
    if body.alert_id:
        alert = session.get(Alert, body.alert_id)
        if alert and alert.scenario_run:
            campaign = f"scenario:{alert.scenario_run}"
    r = act.create_recommendation(session, body.customer_id, user.username, body.channel, body.message, campaign, body.alert_id)
    if not r["created"]:
        raise HTTPException(status_code=409, detail={"message": "Blocked by outreach safeguards", "constraints": r["blocked"]})
    return r


@router.post("/workbench/actions/{action_id}/approve")
def workbench_approve(action_id: int, body: ApproveIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _wrap(lambda: act.approve(session, action_id, user.username, body.message, body.channel))


@router.post("/workbench/actions/{action_id}/dismiss")
def workbench_dismiss(action_id: int, body: ReasonIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _wrap(lambda: act.dismiss(session, action_id, user.username, body.reason))


@router.post("/workbench/actions/{action_id}/execute")
def workbench_execute(action_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _wrap(lambda: act.execute_simulated(session, action_id, user.username))


@router.post("/workbench/actions/{action_id}/outcome")
def workbench_outcome(action_id: int, body: OutcomeIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """Record an OBSERVED outcome (entered by a person). Scenario-campaign actions are recorded as simulated."""
    from ..models import OutreachAction
    a = session.get(OutreachAction, action_id)
    simulated_ctx = bool(a and a.campaign.startswith("scenario:"))
    return _wrap(lambda: act.record_observed_outcome(session, action_id, body.outcome, body.notes, user.username,
                                                      source="simulator" if simulated_ctx else "manual", observed=not simulated_ctx))


@router.put("/customers/{customer_id}/contact-preferences")
def put_prefs(customer_id: int, body: PrefIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _need_customer(customer_id)
    return act.set_preferences(session, customer_id, body.opt_out_all, body.opt_out_channels, user.username)


# ---------------------------------------------------------------- reporting
@router.get("/dashboard/overview")
def dashboard_overview(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return dashboard.overview(session)


@router.get("/experiments/report")
def experiments_report(campaign: Optional[str] = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return experiments.build_report(session, campaign)


@router.get("/model/health")
def get_model_health(user: User = Depends(get_current_user)):
    return model_health.build_health()


@router.get("/audit/log")
def audit_log(limit: int = Query(default=50, ge=1, le=200), session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    rows = session.exec(select(AuditLog).order_by(AuditLog.at.desc()).limit(limit)).all()
    return {"entries": [{"at": r.at.isoformat() + "Z", "actor": r.actor, "action": r.action, "target": r.target, "onChain": r.on_chain,
                         "detail": r.detail} for r in rows],
            "note": "Database audit trail. onChain=true only when a blockchain transaction was actually stored."}


# ---------------------------------------------------------------- scenarios
class RunIn(BaseModel):
    scenario: str = "quiet_decline"
    seed: int = Field(default=7, ge=0, le=10_000)


@router.get("/scenarios")
def get_scenarios(user: User = Depends(get_current_user)):
    return {"scenarios": scenarios.list_scenarios()}


@router.post("/scenarios/runs", status_code=201)
def scenario_start(body: RunIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    try:
        run = scenarios.start_run(session, body.scenario, body.seed, user.username)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown scenario")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return scenarios.get_run(session, run.run_id)


@router.get("/scenarios/runs/{run_id}")
def scenario_get(run_id: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _wrap(lambda: scenarios.get_run(session, run_id))


@router.post("/scenarios/runs/{run_id}/step")
def scenario_step(run_id: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _wrap(lambda: scenarios.advance(session, run_id, user.username))


@router.delete("/scenarios/runs/{run_id}")
def scenario_reset(run_id: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _wrap(lambda: scenarios.reset_run(session, run_id, user.username))
