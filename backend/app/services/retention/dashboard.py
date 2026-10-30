"""Read models for the Overview dashboard and the unified customer timeline.
Everything here is derived from persisted rows; nothing is generated for display."""
import json
from collections import Counter
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from ...models import (Alert, AlertHistory, AuditLog, BookSnapshot, Complaint, ComplaintMessage, CustomerEvent,
                       OutreachAction, OutreachOutcome, RiskSnapshot)
from ..churn import score_all_customers
from ..outreach import effectiveness
from .alerts import ACTIVE_STATUSES, alert_counts, alert_to_dict, book_snapshot, list_alerts
from .event_store import event_to_dict
from .experiments import build_report


def _iso(dt: datetime) -> str:
    return dt.isoformat() + "Z"


def overview(session: Session) -> dict:
    book_snapshot(session)
    df = score_all_customers()
    lv = df["churn_risk_level"].value_counts().to_dict()
    at_risk = df[df["churn_risk_level"].isin(["critical", "high"])]
    counts = alert_counts(session)
    approved = session.exec(select(OutreachAction).where(OutreachAction.status == "approved")).all()
    exp = build_report(session)
    eff = effectiveness(session)

    snaps = list(session.exec(select(BookSnapshot).order_by(BookSnapshot.at.desc()).limit(60)).all())[::-1]
    start = snaps[0].at if snaps else datetime.utcnow()
    annotations = []
    for a in session.exec(select(Alert).where(Alert.created_at >= start)).all():
        annotations.append({"at": _iso(a.created_at), "kind": "alert", "severity": a.severity, "label": f"{a.id}: {a.trigger.replace('_', ' ')}",
                            "simulated": a.data_source == "simulator", "ref": {"alertId": a.id, "customerId": a.customer_id}})
    for l in session.exec(select(AuditLog).where(AuditLog.at >= start, AuditLog.action.in_(["model_retrained", "outreach_executed_simulated"]))).all():
        annotations.append({"at": _iso(l.at), "kind": "model" if l.action == "model_retrained" else "outreach",
                            "label": l.action.replace("_", " "), "severity": None, "simulated": "simulated" in l.action})
    annotations.sort(key=lambda x: x["at"])

    since = datetime.utcnow() - timedelta(days=30)
    ev_types = Counter(e.event_type for e in session.exec(select(CustomerEvent).where(CustomerEvent.event_ts >= since)).all())
    sim_events = session.exec(select(CustomerEvent).where(CustomerEvent.source == "simulator")).all()

    queue = list_alerts(session, status="active", sort="severity", limit=8)

    recent = []
    for l in session.exec(select(AuditLog).order_by(AuditLog.at.desc()).limit(12)).all():
        recent.append({"at": _iso(l.at), "actor": l.actor, "action": l.action, "target": l.target, "onChain": l.on_chain,
                       "detail": json.loads(l.detail) if l.detail else None})

    return {
        "generatedAt": _iso(datetime.utcnow()),
        "kpis": {
            "monitored": int(len(df)),
            "highCritical": int(len(at_risk)), "critical": int(lv.get("critical", 0)), "high": int(lv.get("high", 0)),
            "exposureAtRisk": round(float(at_risk["Balance"].sum()), 2), "totalBalance": round(float(df["Balance"].sum()), 2),
            "newAlerts": counts["open"], "activeAlerts": counts["active"],
            "approvedAwaitingExecution": len(approved),
            "observedRetention": {"rate": exp["treatment"]["retentionRate"], "measured": exp["treatment"]["measured"],
                                  "pending": exp["treatment"]["pending"], "holdoutMeasured": exp["holdout"]["measured"],
                                  "sampleAdequate": exp["sampleAdequate"]},
        },
        "riskLevels": {k: int(lv.get(k, 0)) for k in ("critical", "high", "medium", "low")},
        "trajectory": [{"at": _iso(s.at), "avgRisk": s.avg_risk, "critical": s.critical, "high": s.high,
                        "exposureAtRisk": s.exposure_at_risk} for s in snaps],
        "annotations": annotations,
        "queue": queue["alerts"], "queueTotal": queue["total"],
        "signals": {"alertsByTrigger": counts["byTrigger"], "alertsBySeverity": counts["bySeverity"],
                    "eventsLast30d": dict(ev_types), "simulatedEvents": len(sim_events),
                    "inactiveMembers": int((df["Is Active Member"] == 0).sum()),
                    "customersWithComplaints": int((df["complaint_count"] > 0).sum())},
        "retention": {"byChannel": eff["by_channel"], "bySegment": eff["by_segment"], "total": eff["total"],
                      "simulatedOutcomesExcluded": eff.get("simulated_outcomes_excluded", 0),
                      "experiment": {"treatment": exp["treatment"], "holdout": exp["holdout"], "comparison": exp["comparison"],
                                     "sampleAdequate": exp["sampleAdequate"]}},
        "recent": recent,
    }


def timeline(session: Session, customer_id: int, limit: int = 200) -> list[dict]:
    items = []

    def add(at, kind, title, **kw):
        items.append({"at": _iso(at), "kind": kind, "title": title, **kw})

    for e in session.exec(select(CustomerEvent).where(CustomerEvent.customer_id == customer_id)).all():
        label = e.event_type.replace("_", " ")
        if e.amount:
            label += f" {e.amount:,.0f}"
        add(e.event_ts, "event", label, source=e.source, simulated=e.source == "simulator", detail={"channel": e.channel, "balanceAfter": e.balance_after})
    for s in session.exec(select(RiskSnapshot).where(RiskSnapshot.customer_id == customer_id)).all():
        add(s.at, "score", f"Risk score {s.score:.0f} ({s.level})", simulated=s.source == "simulator", value=s.score)
    for a in session.exec(select(Alert).where(Alert.customer_id == customer_id)).all():
        add(a.created_at, "alert", f"{a.id} raised: {a.trigger.replace('_', ' ')}", severity=a.severity, simulated=a.data_source == "simulator", ref=a.id)
        for h in session.exec(select(AlertHistory).where(AlertHistory.alert_id == a.id)).all():
            if h.from_status and h.from_status != h.to_status:
                add(h.at, "alert", f"{a.id}: {h.from_status} -> {h.to_status} by {h.actor}", ref=a.id, detail={"note": h.note})
    for c in session.exec(select(Complaint).where(Complaint.customer_id == customer_id)).all():
        add(c.created_at, "complaint", f"Complaint {c.id}: {c.subject}", severity=c.severity, ref=c.id)
        if c.resolved_at:
            add(c.resolved_at, "complaint", f"Complaint {c.id} resolved", ref=c.id)
    outcomes = {o.action_id: o for o in session.exec(select(OutreachOutcome)).all()}
    for a in session.exec(select(OutreachAction).where(OutreachAction.customer_id == customer_id)).all():
        add(a.created_at, "outreach", f"Outreach #{a.id} {a.status} via {a.channel.replace('_', ' ')}",
            simulated=a.simulated, detail={"group": a.experiment_group, "campaign": a.campaign}, ref=a.id)
        o = outcomes.get(a.id)
        if o:
            add(o.created_at, "outcome", f"Outcome for #{a.id}: {o.outcome.replace('_', ' ')}", simulated=not o.observed, detail={"source": o.source})
    items.sort(key=lambda x: x["at"], reverse=True)
    return items[:limit]
