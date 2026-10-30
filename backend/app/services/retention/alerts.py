"""Persistent early-warning alerts.

An alert is only created when a *specific, named trigger* fires, and it stores
the evidence (feature values + observation windows) that fired it. First
evaluation of a customer only records a baseline score - it never alerts on
"already high" - so the queue reflects change, not the size of the book.
"""
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from ...models import Alert, AlertHistory, BookSnapshot, CustomerSignal, RiskSnapshot
from ..churn import invalidate_scoring_cache, score_all_customers
from ..events import publish
from .event_store import audit, events_for
from .features import compute_features, signal_overlay

ACTIVE_STATUSES = ("open", "acknowledged", "in_progress")
TRANSITIONS = {
    "open": {"acknowledged", "in_progress", "resolved", "dismissed"},
    "acknowledged": {"in_progress", "resolved", "dismissed"},
    "in_progress": {"resolved", "dismissed"},
    "resolved": {"open"},
    "dismissed": {"open"},
}
NEEDS_REASON = {"resolved", "dismissed"}
TRIGGER_PRIORITY = ["high_risk", "risk_jump", "complaint_spike", "inactivity", "balance_decline"]


@dataclass
class AlertConfig:
    critical_score: float = 70.0
    high_score: float = 50.0
    risk_jump_points: float = 10.0
    inactivity_days: int = 30
    balance_decline_pct: float = 40.0
    complaint_spike_30d: int = 2
    cooldown_hours: int = 24
    min_score_for_behaviour_alert: float = 30.0


_BOUNDS = {
    "critical_score": (50, 100), "high_score": (20, 95), "risk_jump_points": (3, 50),
    "inactivity_days": (7, 180), "balance_decline_pct": (10, 95), "complaint_spike_30d": (1, 20),
    "cooldown_hours": (0, 24 * 30), "min_score_for_behaviour_alert": (0, 90),
}
_config: Optional[AlertConfig] = None


def _from_env() -> AlertConfig:
    cfg = AlertConfig()
    for name, default in asdict(cfg).items():
        raw = os.getenv(f"ALERT_{name.upper()}")
        if raw is not None:
            try:
                setattr(cfg, name, type(default)(float(raw)))
            except ValueError:
                pass
    return validate(cfg)


def validate(cfg: AlertConfig) -> AlertConfig:
    for name, (lo, hi) in _BOUNDS.items():
        v = getattr(cfg, name)
        setattr(cfg, name, type(getattr(AlertConfig(), name))(min(max(v, lo), hi)))
    if cfg.high_score >= cfg.critical_score:
        cfg.high_score = max(20, cfg.critical_score - 10)
    return cfg


def get_config() -> AlertConfig:
    global _config
    if _config is None:
        _config = _from_env()
    return _config


def update_config(changes: dict) -> AlertConfig:
    cfg = AlertConfig(**{**asdict(get_config()), **{k: v for k, v in changes.items() if k in _BOUNDS and v is not None}})
    global _config
    _config = validate(cfg)
    return _config


def _next_id(session: Session) -> str:
    n = len(session.exec(select(Alert.id)).all())
    return f"ALT-{n + 1:06d}"


def _level(score: float, cfg: AlertConfig) -> str:
    return "critical" if score >= cfg.critical_score else "high" if score >= cfg.high_score else "medium" if score >= 30 else "low"


def _detect(features: dict, score: float, prev: Optional[float], cfg: AlertConfig) -> list[dict]:
    found = []
    if prev is not None:
        if prev < cfg.critical_score <= score:
            found.append({"trigger": "high_risk", "text": f"Risk crossed into the critical band: {prev:.0f} -> {score:.0f} (threshold {cfg.critical_score:.0f})."})
        elif prev < cfg.high_score <= score < cfg.critical_score:
            found.append({"trigger": "high_risk", "text": f"Risk crossed into the high band: {prev:.0f} -> {score:.0f} (threshold {cfg.high_score:.0f})."})
        if score - prev >= cfg.risk_jump_points and score >= cfg.min_score_for_behaviour_alert:
            found.append({"trigger": "risk_jump", "text": f"Risk score rose {score - prev:.0f} points since the last evaluation ({prev:.0f} -> {score:.0f})."})
    if score >= cfg.min_score_for_behaviour_alert and features["sufficiency"] != "cold_start":
        d = features["days_since_last_activity"]
        if d is not None and d >= cfg.inactivity_days:
            found.append({"trigger": "inactivity", "text": f"No login/transaction/product activity for {d:.0f} days (limit {cfg.inactivity_days})."})
        bc = features["balance_change_pct_30d"]
        if bc is not None and bc <= -cfg.balance_decline_pct:
            found.append({"trigger": "balance_decline", "text": f"Balance fell {abs(bc):.0f}% over 30 days ({features['balance_30d_ago']:,.0f} -> {features['balance_now']:,.0f})."})
        c30 = features["windows"]["30d"]["complaints_logged"]
        if c30 >= cfg.complaint_spike_30d or features["unresolved_complaints"] >= cfg.complaint_spike_30d:
            found.append({"trigger": "complaint_spike", "text": f"{c30} complaint(s) logged in 30 days, {features['unresolved_complaints']} unresolved."})
    found.sort(key=lambda t: TRIGGER_PRIORITY.index(t["trigger"]))
    return found


def _recommended_action(primary: str, severity: str) -> str:
    if primary == "complaint_spike":
        return "Service-recovery call first; hold promotional offers until the complaint is resolved."
    if severity == "critical":
        return "Relationship-manager or phone outreach within 24h after human review."
    if primary in ("inactivity", "balance_decline"):
        return "Proactive check-in via the customer's preferred permitted channel within 48h."
    return "Review the customer and decide on outreach within 48h."


def record_snapshot(session: Session, customer_id: int, score: float, level: str, at: datetime,
                    source: str = "model", scenario_run: Optional[str] = None) -> RiskSnapshot:
    snap = RiskSnapshot(customer_id=customer_id, at=at, score=score, level=level, source=source, scenario_run=scenario_run)
    session.add(snap)
    session.commit()
    return snap


def last_snapshot(session: Session, customer_id: int, before: Optional[datetime] = None) -> Optional[RiskSnapshot]:
    stmt = select(RiskSnapshot).where(RiskSnapshot.customer_id == customer_id)
    if before:
        stmt = stmt.where(RiskSnapshot.at < before)
    return session.exec(stmt.order_by(RiskSnapshot.at.desc())).first()


def _apply_overlay(session: Session, customer_id: int, overlay: dict, source: str, note: str) -> bool:
    if not overlay:
        return False
    sig = session.get(CustomerSignal, customer_id) or CustomerSignal(customer_id=customer_id)
    changed = False
    if "is_active_member" in overlay and sig.is_active_member != overlay["is_active_member"]:
        sig.is_active_member, changed = overlay["is_active_member"], True
    if "balance" in overlay and sig.balance != overlay["balance"]:
        sig.balance, changed = overlay["balance"], True
    if changed:
        sig.source, sig.note, sig.updated_at = source, note, datetime.utcnow()
        session.add(sig)
        session.commit()
        invalidate_scoring_cache()
    return changed


def evaluate_customer(session: Session, customer_id: int, as_of: Optional[datetime] = None, actor: str = "system",
                      scenario_run: Optional[str] = None, cfg: Optional[AlertConfig] = None) -> dict:
    cfg = cfg or get_config()
    as_of = as_of or datetime.utcnow()
    events = events_for(session, customer_id)
    features = compute_features(events, as_of)
    simulated = bool(scenario_run) or any(e.source == "simulator" for e in events)
    source = "simulator" if simulated else "events"

    overlay = signal_overlay(features, cfg.inactivity_days) if events else {}
    _apply_overlay(session, customer_id, overlay, source, f"Derived from {features['events_total']} events as of {as_of:%Y-%m-%d}")

    df = score_all_customers()
    row = df[df["CustomerId"] == customer_id]
    if row.empty:
        raise KeyError(f"Customer {customer_id} not found")
    row = row.iloc[0]
    score, level = float(row["churn_risk_score"]), _level(float(row["churn_risk_score"]), cfg)

    prev_snap = last_snapshot(session, customer_id, before=as_of + timedelta(seconds=1))
    prev = prev_snap.score if prev_snap else None
    if prev_snap is None or abs(prev_snap.score - score) > 1e-9:
        record_snapshot(session, customer_id, score, level, as_of, source=source, scenario_run=scenario_run)

    result = {"customerId": customer_id, "score": score, "previousScore": prev, "features": features,
              "baselineEstablished": prev is None, "created": None, "suppressed": None, "triggers": []}
    triggers = _detect(features, score, prev, cfg)
    result["triggers"] = triggers
    if not triggers:
        return result

    primary = triggers[0]["trigger"]
    active = session.exec(select(Alert).where(Alert.customer_id == customer_id, Alert.status.in_(ACTIVE_STATUSES))).first()
    if active:
        known = {t["trigger"] for t in json.loads(active.explanation or "[]")}
        new = [t for t in triggers if t["trigger"] not in known]
        if new:
            active.explanation = json.dumps([*json.loads(active.explanation or "[]"), *new])
            ev = json.loads(active.evidence or "{}")
            ev["features"] = features  # evidence always reflects the latest observation window
            active.evidence = json.dumps(ev)
            active.risk_score, active.updated_at = score, datetime.utcnow()
            rank = {"medium": 0, "high": 1, "critical": 2}
            new_sev = level if level in rank else "medium"
            if rank[new_sev] > rank.get(active.severity, 0):
                active.severity = new_sev
                active.recommended_action = _recommended_action(triggers[0]["trigger"], new_sev)
            session.add(active)
            session.add(AlertHistory(alert_id=active.id, actor=actor, from_status=active.status, to_status=active.status,
                                     note="New evidence: " + "; ".join(t["text"] for t in new)))
            session.commit()
        result["suppressed"] = {"reason": "active_alert_exists", "alertId": active.id, "newEvidenceAdded": bool(new)}
        return result

    dedupe_key = f"{customer_id}:{primary}"
    cutoff = as_of - timedelta(hours=cfg.cooldown_hours)
    recent = session.exec(select(Alert).where(Alert.dedupe_key == dedupe_key, Alert.trigger_ts > cutoff)).first()
    if recent:
        result["suppressed"] = {"reason": "cooldown", "alertId": recent.id}
        return result

    severity = level if level in ("critical", "high") else "medium"
    quality = {"ok": "ok", "sparse": "sparse", "cold_start": "sparse"}[features["sufficiency"]]
    alert = Alert(
        id=_next_id(session), customer_id=customer_id, severity=severity, risk_score=score, prev_risk_score=prev,
        trigger=primary, trigger_ts=as_of, explanation=json.dumps(triggers),
        evidence=json.dumps({"features": features, "thresholds": asdict(cfg), "scoring_pathway":
                             "event features -> Is Active Member / Balance overlay -> RandomForest" if overlay else "RandomForest on dataset fields"}),
        data_source="simulator" if simulated else ("events" if events else "model"), quality=quality,
        recommended_action=_recommended_action(primary, severity), dedupe_key=dedupe_key, scenario_run=scenario_run,
    )
    session.add(alert)
    session.add(AlertHistory(alert_id=alert.id, actor=actor, to_status="open", note="Alert created: " + triggers[0]["text"]))
    audit(session, actor, "alert_created", alert.id, {"customer": customer_id, "trigger": primary, "score": score})
    session.commit()
    session.refresh(alert)
    publish("alert_created", f"{severity.upper()} alert {alert.id}: {triggers[0]['text']}", severity=severity,
            ref={"alertId": alert.id, "customerId": customer_id}, data={"trigger": primary, "simulated": simulated})
    result["created"] = alert.id
    return result


def transition(session: Session, alert_id: str, to_status: str, actor: str, note: Optional[str] = None,
               assignee: Optional[str] = None) -> Alert:
    alert = session.get(Alert, alert_id)
    if not alert:
        raise KeyError(alert_id)
    if to_status not in TRANSITIONS.get(alert.status, set()) and to_status != alert.status:
        raise ValueError(f"cannot move alert from {alert.status} to {to_status}")
    if to_status in NEEDS_REASON and not (note and note.strip()):
        raise ValueError(f"a reason is required to mark an alert {to_status}")
    prev = alert.status
    alert.status, alert.updated_at = to_status, datetime.utcnow()
    if assignee:
        alert.assignee = assignee
    if to_status in NEEDS_REASON:
        alert.resolved_at, alert.resolution_reason = datetime.utcnow(), note.strip()[:1000]
    if to_status == "open":
        alert.resolved_at, alert.resolution_reason = None, None
    session.add(alert)
    session.add(AlertHistory(alert_id=alert_id, actor=actor, from_status=prev, to_status=to_status, note=(note or "")[:1000] or None))
    audit(session, actor, f"alert_{to_status}", alert_id, {"from": prev, "note": (note or "")[:200]})
    session.commit()
    session.refresh(alert)
    publish("alert_updated", f"{alert_id} {prev} -> {to_status} by {actor}", ref={"alertId": alert_id, "customerId": alert.customer_id})
    return alert


def assign(session: Session, alert_id: str, assignee: str, actor: str) -> Alert:
    alert = session.get(Alert, alert_id)
    if not alert:
        raise KeyError(alert_id)
    alert.assignee, alert.updated_at = assignee[:60], datetime.utcnow()
    session.add(alert)
    session.add(AlertHistory(alert_id=alert_id, actor=actor, from_status=alert.status, to_status=alert.status, note=f"Assigned to {assignee[:60]}"))
    audit(session, actor, "alert_assigned", alert_id, {"assignee": assignee[:60]})
    session.commit()
    session.refresh(alert)
    return alert


def add_note(session: Session, alert_id: str, actor: str, note: str) -> None:
    if not session.get(Alert, alert_id):
        raise KeyError(alert_id)
    session.add(AlertHistory(alert_id=alert_id, actor=actor, to_status=session.get(Alert, alert_id).status, note=note.strip()[:1000]))
    session.commit()


def alert_to_dict(a: Alert, customers=None, history: Optional[list] = None) -> dict:
    d = {
        "id": a.id, "customerId": a.customer_id, "severity": a.severity, "riskScore": a.risk_score,
        "previousRiskScore": a.prev_risk_score,
        "scoreChange": None if a.prev_risk_score is None else round(a.risk_score - a.prev_risk_score, 1),
        "trigger": a.trigger, "triggerAt": a.trigger_ts.isoformat() + "Z", "explanation": json.loads(a.explanation or "[]"),
        "dataSource": a.data_source, "quality": a.quality, "simulated": a.data_source == "simulator",
        "recommendedAction": a.recommended_action, "status": a.status, "assignee": a.assignee,
        "createdAt": a.created_at.isoformat() + "Z", "updatedAt": a.updated_at.isoformat() + "Z",
        "resolvedAt": a.resolved_at.isoformat() + "Z" if a.resolved_at else None, "resolutionReason": a.resolution_reason,
        "scenarioRun": a.scenario_run,
    }
    if customers is not None and a.customer_id in customers.index:
        c = customers.loc[a.customer_id]
        d.update(surname=c["Surname"], branch=c["branch"], balance=float(c["Balance"]))
    if history is not None:
        d["evidence"] = json.loads(a.evidence or "{}")
        d["history"] = [{"at": h.at.isoformat() + "Z", "actor": h.actor, "from": h.from_status, "to": h.to_status, "note": h.note} for h in history]
    return d


def list_alerts(session: Session, *, status: Optional[str] = None, severity: Optional[str] = None, q: Optional[str] = None,
                sort: str = "recent", include_simulated: bool = True, limit: int = 50, offset: int = 0) -> dict:
    stmt = select(Alert)
    if status == "active":
        stmt = stmt.where(Alert.status.in_(ACTIVE_STATUSES))
    elif status:
        stmt = stmt.where(Alert.status == status)
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if not include_simulated:
        stmt = stmt.where(Alert.data_source != "simulator")
    rows = list(session.exec(stmt).all())
    customers = score_all_customers().set_index("CustomerId")
    if q:
        needle = q.strip().lower()
        rows = [a for a in rows if needle in a.id.lower() or needle in str(a.customer_id)
                or (a.customer_id in customers.index and needle in str(customers.loc[a.customer_id, "Surname"]).lower())]
    sev_rank = {"critical": 0, "high": 1, "medium": 2}
    keys = {"recent": lambda a: -a.created_at.timestamp(), "severity": lambda a: (sev_rank.get(a.severity, 3), -a.risk_score),
            "score": lambda a: -a.risk_score, "change": lambda a: -(a.risk_score - (a.prev_risk_score if a.prev_risk_score is not None else a.risk_score))}
    rows.sort(key=keys.get(sort, keys["recent"]))
    total = len(rows)
    return {"total": total, "alerts": [alert_to_dict(a, customers) for a in rows[offset: offset + limit]]}


def alert_counts(session: Session) -> dict:
    rows = session.exec(select(Alert)).all()
    active = [a for a in rows if a.status in ACTIVE_STATUSES]
    return {"total": len(rows), "active": len(active), "open": sum(a.status == "open" for a in rows),
            "bySeverity": {s: sum(a.severity == s for a in active) for s in ("critical", "high", "medium")},
            "byTrigger": {t: sum(a.trigger == t for a in active) for t in TRIGGER_PRIORITY if any(a.trigger == t for a in active)}}


def book_snapshot(session: Session, force: bool = False, min_gap_minutes: int = 10) -> Optional[BookSnapshot]:
    last = session.exec(select(BookSnapshot).order_by(BookSnapshot.at.desc())).first()
    now = datetime.utcnow()
    if last and not force and (now - last.at) < timedelta(minutes=min_gap_minutes):
        return None
    df = score_all_customers()
    lv = df["churn_risk_level"].value_counts().to_dict()
    exposure = float(df[df["churn_risk_level"].isin(["critical", "high"])]["Balance"].sum())
    snap = BookSnapshot(at=now, monitored=int(len(df)), avg_risk=round(float(df["churn_risk_score"].mean()), 2),
                        critical=int(lv.get("critical", 0)), high=int(lv.get("high", 0)), medium=int(lv.get("medium", 0)),
                        low=int(lv.get("low", 0)), exposure_at_risk=round(exposure, 2))
    session.add(snap)
    session.commit()
    return snap
