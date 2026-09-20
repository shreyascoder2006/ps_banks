from datetime import datetime

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..auth import User, get_current_user
from ..db import get_session
from ..models import Complaint, ComplaintMessage, OutreachAction, OutreachOutcome

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("")
def activity(limit: int = 25, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """Unified, newest-first event feed across complaints and outreach so
    the Overview page can show the bank's operational pulse."""
    events = []

    for c in session.exec(select(Complaint).order_by(Complaint.created_at.desc()).limit(limit)).all():
        events.append({
            "type": "complaint_logged", "at": c.created_at, "severity": c.severity,
            "title": f"{c.customer_name}: {c.subject}", "ref": {"complaintId": c.id, "customerId": c.customer_id},
        })

    for m in session.exec(
        select(ComplaintMessage).where(ComplaintMessage.author == "system").order_by(ComplaintMessage.created_at.desc()).limit(limit)
    ).all():
        events.append({
            "type": "complaint_update", "at": m.created_at, "severity": None,
            "title": f"{m.complaint_id}: {m.body}", "ref": {"complaintId": m.complaint_id},
        })

    outcomes = {o.action_id: o for o in session.exec(select(OutreachOutcome)).all()}
    for a in session.exec(select(OutreachAction).order_by(OutreachAction.created_at.desc()).limit(limit)).all():
        events.append({
            "type": "outreach_triggered", "at": a.created_at, "severity": None,
            "title": f"Outreach #{a.id} via {a.channel.replace('_', ' ')} to CUST-{a.customer_id} ({a.risk_score_at_trigger:.0f}% risk)",
            "ref": {"actionId": a.id, "customerId": a.customer_id}, "audit": a.audit_status,
        })
        o = outcomes.get(a.id)
        if o:
            events.append({
                "type": "outreach_outcome", "at": o.created_at, "severity": None,
                "title": f"Outreach #{a.id} outcome: {o.outcome.replace('_', ' ')}",
                "ref": {"actionId": a.id, "customerId": a.customer_id},
            })

    events.sort(key=lambda e: e["at"], reverse=True)
    for e in events:
        e["at"] = e["at"].isoformat() + "Z"
    return {"events": events[:limit], "generatedAt": datetime.utcnow().isoformat() + "Z"}
