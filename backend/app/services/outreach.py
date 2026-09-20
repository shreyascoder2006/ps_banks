"""Predictive outreach engine (PS4).

Turns a churn prediction into an action: picks the outreach channel from
real customer signals, personalises the offer/message, records the action,
writes an audit hash on-chain, and captures the outcome so effectiveness
can be measured and fed back into the model.

Channel rules are deliberately transparent (each returns a human-readable
reason) rather than a black box, so the fraud/retention team can see why a
customer was routed to an RM visit vs. an SMS nudge.
"""
import json
from collections import defaultdict
from typing import Optional

from sqlmodel import Session, select

from .llm import complete
from ..models import Complaint, OutreachAction, OutreachOutcome
from .blockchain import record_event
from .churn import score_all_customers
from .events import publish
from .segmentation import compute_personalised_offer, compute_segments

CHANNELS = ("rm_visit", "call", "email", "sms", "in_app")
CHANNEL_LABELS = {
    "rm_visit": "Relationship manager visit",
    "call": "Phone call",
    "email": "Email",
    "sms": "SMS",
    "in_app": "In-app notification",
}
OUTCOMES = ("retained", "churned", "no_response")


def _customer_context(session: Session, customer_id: int) -> dict:
    scored = score_all_customers()
    row = scored[scored["CustomerId"] == customer_id]
    if row.empty:
        raise KeyError(f"Customer {customer_id} not found")
    row = row.iloc[0]

    seg = compute_segments()
    seg_row = seg[seg["CustomerId"] == customer_id].iloc[0]

    open_complaints = session.exec(
        select(Complaint).where(Complaint.customer_id == customer_id, Complaint.status != "resolved")
    ).all()
    prior_actions = session.exec(
        select(OutreachAction).where(OutreachAction.customer_id == customer_id).order_by(OutreachAction.created_at.desc())
    ).all()

    return {
        "row": row,
        "segment_row": seg_row,
        "open_complaints": open_complaints,
        "prior_actions": prior_actions,
    }


def choose_channel(ctx: dict) -> tuple[str, list[str]]:
    row, open_complaints, prior = ctx["row"], ctx["open_complaints"], ctx["prior_actions"]
    reasons: list[str] = []

    if open_complaints:
        reasons.append(f"{len(open_complaints)} unresolved complaint(s) - needs a human touchpoint")
        return "call", reasons

    if row["segment"] == "hni" or row["Balance"] >= 1_000_000:
        reasons.append("HNI / high-balance relationship - warrants in-person RM visit")
        return "rm_visit", reasons

    if row["churn_risk_level"] == "critical" and row["Is Active Member"] == 0:
        reasons.append("Critical risk and no recent activity - digital channels unlikely to land")
        return "call", reasons

    if row["Is Active Member"] == 1 and row["churn_risk_level"] in ("critical", "high"):
        reasons.append("Active digital user at elevated risk - in-app is the highest-engagement channel")
        return "in_app", reasons

    if row["churn_risk_level"] == "medium":
        reasons.append("Medium risk - email keeps cost low while surfacing the offer")
        return "email", reasons

    reasons.append("Low risk - lightweight SMS nudge is sufficient")
    return "sms", reasons


def _personalise_message(row, offer: dict, channel: str) -> tuple[str, str]:
    fallback = (
        f"Dear {row['Surname']}, thank you for banking with us for {int(row['Tenure'])} year(s). "
        f"{offer['message']} Your {row['branch']} branch team would be glad to help - reply or visit at your convenience."
    )
    prompt = (
        f"Write a {CHANNEL_LABELS[channel].lower()} message (under 90 words) from an Indian bank to a customer.\n"
        f"Customer surname: {row['Surname']}. Tenure: {int(row['Tenure'])} years. Branch: {row['branch']}. "
        f"Segment: {row['segment']}. Products held: {', '.join(row['products'])}.\n"
        f"Offer to include: {offer['offer_type']} - {offer['message']}\n"
        "Tone: warm, specific, no exclamation marks, never say 'valued customer'. Return only the message text."
    )
    out, tag = complete("", prompt, max_tokens=220, temperature=0.5)
    return (out, tag) if out else (fallback, tag)


def recommend(session: Session, customer_id: int) -> dict:
    ctx = _customer_context(session, customer_id)
    row, seg_row = ctx["row"], ctx["segment_row"]

    channel, reasons = choose_channel(ctx)
    offer = compute_personalised_offer(seg_row["recency"], seg_row["frequency"], seg_row["monetary"], seg_row["segment"])
    message, message_source = _personalise_message(row, offer, channel)

    reasons = [*row["churn_drivers"], *reasons]
    if ctx["prior_actions"]:
        last = ctx["prior_actions"][0]
        reasons.append(f"Previously contacted via {CHANNEL_LABELS[last.channel].lower()} on {last.created_at.date()}")

    return {
        "customerId": customer_id,
        "surname": row["Surname"],
        "branch": row["branch"],
        "churnRiskScore": float(row["churn_risk_score"]),
        "churnRiskLevel": row["churn_risk_level"],
        "segment": seg_row["segment"],
        "channel": channel,
        "channelLabel": CHANNEL_LABELS[channel],
        "offerType": offer["offer_type"],
        "message": message,
        "messageSource": message_source,
        "reasons": reasons,
        "openComplaints": len(ctx["open_complaints"]),
        "priorOutreachCount": len(ctx["prior_actions"]),
    }


def trigger(session: Session, customer_id: int, triggered_by: str, channel: Optional[str] = None, message: Optional[str] = None) -> dict:
    rec = recommend(session, customer_id)
    chosen = channel if channel in CHANNELS else rec["channel"]
    final_message = message or rec["message"]

    action = OutreachAction(
        customer_id=customer_id,
        channel=chosen,
        offer_type=rec["offerType"],
        message=final_message,
        reason=" | ".join(rec["reasons"]),
        risk_score_at_trigger=rec["churnRiskScore"],
        triggered_by=triggered_by,
    )
    session.add(action)
    session.commit()
    session.refresh(action)

    audit = record_event(
        "outreach_triggered",
        f"Outreach #{action.id} via {chosen} to CUST-{customer_id}",
        json.dumps({"action_id": action.id, "customer_id": customer_id, "channel": chosen, "risk": rec["churnRiskScore"], "by": triggered_by}),
    )
    action.audit_status = audit.get("status")
    action.audit_tx_hash = audit.get("tx_hash")
    session.add(action)
    session.commit()
    session.refresh(action)

    publish(
        "outreach_triggered",
        f"Outreach #{action.id} via {CHANNEL_LABELS[chosen].lower()} to {rec['surname']} ({rec['churnRiskScore']:.0f}% risk) by {triggered_by}",
        severity=rec["churnRiskLevel"] if rec["churnRiskLevel"] in ("critical", "high") else None,
        ref={"actionId": action.id, "customerId": customer_id, "branch": str(rec["branch"])},
        data={"channel": chosen, "audit": audit},
    )
    return {"action": action_to_dict(action), "audit": audit, "recommendation": rec}


def record_outcome(session: Session, action_id: int, outcome: str, notes: Optional[str]) -> dict:
    if outcome not in OUTCOMES:
        raise ValueError(f"Invalid outcome '{outcome}'")
    action = session.get(OutreachAction, action_id)
    if not action:
        raise KeyError("Outreach action not found")
    existing = session.exec(select(OutreachOutcome).where(OutreachOutcome.action_id == action_id)).first()
    if existing:
        existing.outcome = outcome
        existing.notes = notes
        session.add(existing)
        row = existing
    else:
        row = OutreachOutcome(action_id=action_id, outcome=outcome, notes=notes)
        session.add(row)
    session.commit()
    session.refresh(row)
    publish("outreach_outcome", f"Outreach #{action_id} outcome: {outcome.replace('_', ' ')}",
            severity="low" if outcome == "retained" else ("critical" if outcome == "churned" else None),
            ref={"actionId": action_id, "customerId": action.customer_id}, data={"outcome": outcome})
    return {"actionId": action_id, "outcome": row.outcome, "notes": row.notes, "recordedAt": row.created_at.isoformat() + "Z"}


def action_to_dict(a: OutreachAction, outcome: Optional[OutreachOutcome] = None) -> dict:
    return {
        "id": a.id,
        "customerId": a.customer_id,
        "channel": a.channel,
        "channelLabel": CHANNEL_LABELS.get(a.channel, a.channel),
        "offerType": a.offer_type,
        "message": a.message,
        "reason": a.reason.split(" | ") if a.reason else [],
        "riskScoreAtTrigger": a.risk_score_at_trigger,
        "triggeredBy": a.triggered_by,
        "createdAt": a.created_at.isoformat() + "Z",
        "auditStatus": a.audit_status,
        "auditTxHash": a.audit_tx_hash,
        "outcome": outcome.outcome if outcome else None,
        "outcomeNotes": outcome.notes if outcome else None,
    }


def list_actions(session: Session, customer_id: Optional[int] = None) -> list[dict]:
    stmt = select(OutreachAction).order_by(OutreachAction.created_at.desc())
    if customer_id is not None:
        stmt = stmt.where(OutreachAction.customer_id == customer_id)
    actions = session.exec(stmt).all()
    outcomes = {o.action_id: o for o in session.exec(select(OutreachOutcome)).all()}
    scored = score_all_customers().set_index("CustomerId")
    out = []
    for a in actions:
        d = action_to_dict(a, outcomes.get(a.id))
        if a.customer_id in scored.index:
            d["surname"] = scored.loc[a.customer_id, "Surname"]
            d["segment"] = scored.loc[a.customer_id, "segment"]
        out.append(d)
    return out


def effectiveness(session: Session) -> dict:
    actions = session.exec(select(OutreachAction)).all()
    outcomes = {o.action_id: o.outcome for o in session.exec(select(OutreachOutcome)).all()}
    scored = score_all_customers().set_index("CustomerId")

    def bucket():
        return {"sent": 0, "retained": 0, "churned": 0, "no_response": 0, "pending": 0}

    by_channel = defaultdict(bucket)
    by_segment = defaultdict(bucket)
    total = bucket()

    for a in actions:
        seg = scored.loc[a.customer_id, "segment"] if a.customer_id in scored.index else "unknown"
        oc = outcomes.get(a.id, "pending")
        for b in (by_channel[a.channel], by_segment[seg], total):
            b["sent"] += 1
            b[oc] += 1

    def finalise(b: dict) -> dict:
        measured = b["retained"] + b["churned"] + b["no_response"]
        return {**b, "retention_rate": round(b["retained"] / measured, 3) if measured else None}

    return {
        "total": finalise(total),
        "by_channel": {k: {"label": CHANNEL_LABELS.get(k, k), **finalise(v)} for k, v in by_channel.items()},
        "by_segment": {k: finalise(v) for k, v in by_segment.items()},
        "note": "retention_rate = retained / (retained + churned + no_response); pending outcomes are excluded.",
    }
