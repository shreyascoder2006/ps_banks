"""Outreach safeguards and action lifecycle.

Lifecycle: recommended -> approved -> delivered (simulated) | failed | dismissed,
with `withheld` for holdout customers. Nothing here sends a real message: no
delivery integration exists, so "delivered" always means a *simulated* delivery
and the row carries simulated=True.

Ranking is rule-based and every option lists its reasons and constraints. No
success probability is invented; observed channel results are shown only as
evidence with their sample size.
"""
import hashlib
import json
import os
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from ...models import Alert, ContactPreference, OutreachAction, OutreachOutcome
from ..churn import invalidate_scoring_cache, score_all_customers
from ..events import publish
from ..outreach import CHANNEL_LABELS, CHANNELS, choose_channel, effectiveness, recommend
from .event_store import audit, ingest_event

COOLDOWN_DAYS = int(os.getenv("OUTREACH_COOLDOWN_DAYS", "7"))
MAX_CONTACTS_30D = int(os.getenv("OUTREACH_MAX_PER_30D", "3"))
HOLDOUT_PCT = int(os.getenv("HOLDOUT_PCT", "10"))
LIVE = ("recommended", "approved")
CONTACTED = ("approved", "delivered", "executed", "attempted", "queued")
# Static, documented tie-break order used only to rank *feasible* alternatives
# (cost/intrusiveness, cheapest first). Not an effectiveness claim.
COST_ORDER = {"in_app": 1, "sms": 2, "email": 3, "call": 4, "rm_visit": 5}


def holdout_group(customer_id: int, campaign: str, pct: Optional[int] = None) -> str:
    """Deterministic assignment so a customer never flips groups between calls."""
    pct = HOLDOUT_PCT if pct is None else pct
    h = int(hashlib.sha256(f"{campaign}:{customer_id}".encode()).hexdigest()[:8], 16) % 100
    return "holdout" if h < pct else "treatment"


def preferences(session: Session, customer_id: int) -> dict:
    p = session.get(ContactPreference, customer_id)
    if not p:
        return {"known": False, "optOutAll": False, "optOutChannels": []}
    return {"known": True, "optOutAll": p.opt_out_all, "optOutChannels": [c for c in p.opt_out_channels.split(",") if c]}


def set_preferences(session: Session, customer_id: int, opt_out_all: bool, channels: list[str], actor: str) -> dict:
    channels = [c for c in channels if c in CHANNELS]
    p = session.get(ContactPreference, customer_id) or ContactPreference(customer_id=customer_id)
    p.opt_out_all, p.opt_out_channels, p.updated_by, p.updated_at = opt_out_all, ",".join(channels), actor, datetime.utcnow()
    session.add(p)
    audit(session, actor, "contact_preference_updated", f"CUST-{customer_id}", {"optOutAll": opt_out_all, "channels": channels})
    session.commit()
    return preferences(session, customer_id)


def check_constraints(session: Session, customer_id: int, channel: str, now: Optional[datetime] = None,
                      campaign: str = "retention-v1", ignore_action_id: Optional[int] = None) -> list[dict]:
    """Return blocking constraints (empty list => feasible)."""
    now = now or datetime.utcnow()
    blocks = []
    prefs = preferences(session, customer_id)
    if prefs["optOutAll"]:
        blocks.append({"code": "opt_out_all", "text": "Customer has opted out of all outreach."})
    elif channel in prefs["optOutChannels"]:
        blocks.append({"code": "opt_out_channel", "text": f"Customer opted out of {CHANNEL_LABELS[channel].lower()}."})

    actions = [a for a in session.exec(select(OutreachAction).where(OutreachAction.customer_id == customer_id)).all()
               if a.id != ignore_action_id]
    contacted = [a for a in actions if a.status in CONTACTED and a.experiment_group == "treatment"]
    if contacted:
        last = max(contacted, key=lambda a: a.created_at)
        if now - last.created_at < timedelta(days=COOLDOWN_DAYS):
            blocks.append({"code": "cooldown", "text": f"Contacted {(now - last.created_at).days}d ago via {CHANNEL_LABELS.get(last.channel, last.channel).lower()}; cooldown is {COOLDOWN_DAYS} days."})
    recent = [a for a in contacted if now - a.created_at < timedelta(days=30)]
    if len(recent) >= MAX_CONTACTS_30D:
        blocks.append({"code": "frequency_cap", "text": f"{len(recent)} contacts in the last 30 days (cap {MAX_CONTACTS_30D})."})
    if any(a.status in LIVE and a.campaign == campaign for a in actions):
        blocks.append({"code": "duplicate", "text": "A recommendation for this customer is already awaiting action in this campaign."})
    return blocks


def rank_options(session: Session, customer_id: int, now: Optional[datetime] = None) -> dict:
    """Ranked, explained list of channels for a customer, with feasibility."""
    from ..outreach import _customer_context  # reuse the existing context builder
    ctx = _customer_context(session, customer_id)
    preferred, reasons = choose_channel(ctx)
    row = ctx["row"]
    evidence = effectiveness(session)["by_channel"]
    prefs = preferences(session, customer_id)

    options = []
    for ch in CHANNELS:
        blocks = check_constraints(session, customer_id, ch, now)
        notes = []
        if ch == preferred:
            notes.extend(reasons)
        if ctx["open_complaints"] and ch not in ("call", "rm_visit"):
            blocks.append({"code": "service_recovery", "text": "Open complaint: use a human channel for service recovery first."})
        ev = evidence.get(ch)
        measured = ev and (ev["retained"] + ev["churned"] + ev["no_response"])
        options.append({
            "channel": ch, "label": CHANNEL_LABELS[ch], "preferred": ch == preferred, "feasible": not blocks,
            "constraints": blocks, "reasons": notes,
            "observedEvidence": {"measuredOutcomes": int(measured), "retentionRate": ev["retention_rate"],
                                 "caveat": "small sample; not causal" if measured < 30 else "observed, not causal"} if measured else None,
        })
    options.sort(key=lambda o: (not o["feasible"], not o["preferred"], COST_ORDER[o["channel"]]))
    for i, o in enumerate(options, 1):
        o["rank"] = i
    return {
        "customerId": customer_id, "surname": row["Surname"], "riskScore": float(row["churn_risk_score"]),
        "riskLevel": row["churn_risk_level"], "drivers": list(row["churn_drivers"]),
        "preferredChannel": preferred, "consent": {**prefs, "note": "No consent records in the source data; unknown is treated as permitted in this demo." if not prefs["known"] else "Recorded preference."},
        "openComplaints": len(ctx["open_complaints"]), "options": options,
        "ranking": f"Rule-based: feasible first, then the rule-selected channel, then cheapest-first. Cooldown {COOLDOWN_DAYS}d, cap {MAX_CONTACTS_30D}/30d.",
    }


def _snapshot(session: Session, customer_id: int, rec: dict) -> str:
    from .alerts import last_snapshot
    from .event_store import events_for
    from .features import compute_features
    f = compute_features(events_for(session, customer_id), datetime.utcnow())
    snap = last_snapshot(session, customer_id)
    return json.dumps({"risk_score": rec["churnRiskScore"], "risk_level": rec["churnRiskLevel"], "drivers": rec["reasons"][:6],
                       "channel": rec["channel"], "offer": rec["offerType"], "rfm_segment": rec["segment"],
                       "features": f, "previous_snapshot_score": snap.score if snap else None,
                       "captured_at": datetime.utcnow().isoformat()})


def create_recommendation(session: Session, customer_id: int, actor: str, channel: Optional[str] = None,
                          message: Optional[str] = None, campaign: str = "retention-v1", alert_id: Optional[str] = None) -> dict:
    rec = recommend(session, customer_id)
    chosen = channel if channel in CHANNELS else rec["channel"]
    group = "treatment" if campaign.startswith("scenario:") else holdout_group(customer_id, campaign)
    blocks = [] if group == "holdout" else check_constraints(session, customer_id, chosen, campaign=campaign)
    if blocks:
        return {"created": False, "blocked": blocks}
    action = OutreachAction(
        customer_id=customer_id, channel=chosen, offer_type=rec["offerType"], message=(message or rec["message"])[:2000],
        reason=" | ".join(rec["reasons"]), risk_score_at_trigger=rec["churnRiskScore"], triggered_by=actor,
        status="withheld" if group == "holdout" else "recommended", simulated=True, campaign=campaign,
        experiment_group=group, feature_snapshot=_snapshot(session, customer_id, rec),
    )
    session.add(action)
    audit(session, actor, "outreach_recommended" if group == "treatment" else "holdout_assigned", f"CUST-{customer_id}",
          {"channel": chosen, "campaign": campaign, "alert": alert_id})
    if alert_id and (a := session.get(Alert, alert_id)):
        from .alerts import add_note
        session.commit()
        add_note(session, alert_id, actor, f"Outreach {group}: {CHANNEL_LABELS[chosen]} recommendation created")
    session.commit()
    session.refresh(action)
    return {"created": True, "action": _brief(action), "holdout": group == "holdout"}


def _brief(a: OutreachAction) -> dict:
    return {"id": a.id, "customerId": a.customer_id, "channel": a.channel, "channelLabel": CHANNEL_LABELS.get(a.channel, a.channel),
            "status": a.status, "simulated": a.simulated, "group": a.experiment_group, "campaign": a.campaign,
            "message": a.message, "offerType": a.offer_type, "approvedBy": a.approved_by,
            "createdAt": a.created_at.isoformat() + "Z"}


def approve(session: Session, action_id: int, actor: str, message: Optional[str] = None, channel: Optional[str] = None) -> dict:
    a = session.get(OutreachAction, action_id)
    if not a:
        raise KeyError(action_id)
    if a.status != "recommended":
        raise ValueError(f"only a recommended action can be approved (status is {a.status})")
    ch = channel if channel in CHANNELS else a.channel
    blocks = check_constraints(session, a.customer_id, ch, campaign=a.campaign, ignore_action_id=action_id)
    blocks = [b for b in blocks if b["code"] != "duplicate"]
    if blocks:
        raise ValueError("blocked: " + "; ".join(b["text"] for b in blocks))
    if message is not None:
        if not message.strip():
            raise ValueError("message cannot be empty")
        a.message = message.strip()[:2000]
    a.channel, a.status, a.approved_by, a.approved_at = ch, "approved", actor, datetime.utcnow()
    session.add(a)
    audit(session, actor, "outreach_approved", f"action-{action_id}", {"channel": ch, "customer": a.customer_id})
    session.commit()
    session.refresh(a)
    publish("outreach_approved", f"Outreach #{a.id} approved by {actor} ({CHANNEL_LABELS[ch]})", ref={"actionId": a.id, "customerId": a.customer_id})
    return _brief(a)


def dismiss(session: Session, action_id: int, actor: str, reason: str) -> dict:
    a = session.get(OutreachAction, action_id)
    if not a:
        raise KeyError(action_id)
    if a.status not in LIVE:
        raise ValueError(f"cannot dismiss an action that is {a.status}")
    if not reason.strip():
        raise ValueError("a reason is required")
    a.status = "dismissed"
    session.add(a)
    audit(session, actor, "outreach_dismissed", f"action-{action_id}", {"reason": reason[:300]})
    session.commit()
    return _brief(a)


def execute_simulated(session: Session, action_id: int, actor: str) -> dict:
    """Record a SIMULATED delivery of an approved action. No message is sent."""
    from ..blockchain import record_event
    a = session.get(OutreachAction, action_id)
    if not a:
        raise KeyError(action_id)
    if a.status != "approved":
        raise ValueError("action must be approved before execution")
    a.status, a.simulated = "delivered", True
    chain = record_event("outreach_executed", f"Outreach #{a.id} (simulated delivery) via {a.channel} to CUST-{a.customer_id}",
                         json.dumps({"action_id": a.id, "customer_id": a.customer_id, "channel": a.channel, "approved_by": a.approved_by, "simulated": True}))
    a.audit_status, a.audit_tx_hash = chain.get("status"), chain.get("tx_hash")
    session.add(a)
    ingest_event(session, customer_id=a.customer_id, event_type="outreach_delivered", event_ts=datetime.utcnow(), source="simulator",
                 channel=a.channel, metadata={"action_id": a.id, "simulated": True}, idempotency_key=f"outreach-delivered-{a.id}")
    audit(session, actor, "outreach_executed_simulated", f"action-{a.id}", {"customer": a.customer_id, "chain": chain.get("status")},
          on_chain=chain.get("status") == "stored")
    session.commit()
    session.refresh(a)
    invalidate_scoring_cache()
    publish("outreach_triggered", f"SIMULATED outreach #{a.id} via {CHANNEL_LABELS[a.channel].lower()} to CUST-{a.customer_id}",
            ref={"actionId": a.id, "customerId": a.customer_id}, data={"simulated": True, "audit": chain})
    return {**_brief(a), "audit": chain, "notice": "Simulated delivery: no message left the system."}


def record_observed_outcome(session: Session, action_id: int, outcome: str, notes: Optional[str], actor: str,
                            source: str = "manual", observed: bool = True) -> dict:
    """Outcome recording with provenance. A later outcome replaces an earlier one
    (latest wins) and the replacement is audited so conflicts are visible."""
    if outcome not in ("retained", "churned", "no_response"):
        raise ValueError(f"invalid outcome '{outcome}'")
    a = session.get(OutreachAction, action_id)
    if not a:
        raise KeyError(action_id)
    if a.status in LIVE or a.status in ("dismissed",):
        raise ValueError(f"cannot record an outcome for an action that is {a.status}")
    now = datetime.utcnow()
    window_end = a.created_at + timedelta(days=a.observation_days)
    early = now < window_end
    existing = session.exec(select(OutreachOutcome).where(OutreachOutcome.action_id == action_id)).first()
    if existing:
        audit(session, actor, "outcome_changed", f"action-{action_id}", {"from": existing.outcome, "to": outcome, "source": source})
        existing.outcome, existing.notes, existing.source, existing.observed, existing.recorded_by = outcome, (notes or "")[:1000] or None, source, observed, actor
        row = existing
    else:
        row = OutreachOutcome(action_id=action_id, outcome=outcome, notes=(notes or "")[:1000] or None, source=source, observed=observed, recorded_by=actor)
        audit(session, actor, "outcome_recorded", f"action-{action_id}", {"outcome": outcome, "source": source, "observed": observed, "before_window_end": early})
    session.add(row)
    session.commit()
    session.refresh(row)
    invalidate_scoring_cache()
    publish("outreach_outcome", f"Outreach #{action_id} outcome: {outcome.replace('_', ' ')}{'' if observed else ' (simulated)'}",
            ref={"actionId": action_id, "customerId": a.customer_id}, data={"outcome": outcome, "observed": observed})
    return {"actionId": action_id, "outcome": row.outcome, "source": row.source, "observed": row.observed,
            "recordedBy": row.recorded_by, "recordedAt": row.created_at.isoformat() + "Z", "beforeWindowEnd": early,
            "windowEnds": window_end.isoformat() + "Z"}


def list_workbench(session: Session, status: Optional[str] = None, campaign: Optional[str] = None, limit: int = 100) -> list[dict]:
    stmt = select(OutreachAction).order_by(OutreachAction.created_at.desc())
    if status:
        stmt = stmt.where(OutreachAction.status == status)
    if campaign:
        stmt = stmt.where(OutreachAction.campaign == campaign)
    rows = list(session.exec(stmt.limit(limit)).all())
    outcomes = {o.action_id: o for o in session.exec(select(OutreachOutcome)).all()}
    scored = score_all_customers().set_index("CustomerId")
    out = []
    for a in rows:
        o = outcomes.get(a.id)
        d = _brief(a)
        d.update(riskAtTrigger=a.risk_score_at_trigger, observationDays=a.observation_days,
                 windowEnds=(a.created_at + timedelta(days=a.observation_days)).isoformat() + "Z",
                 outcome=o.outcome if o else None, outcomeObserved=o.observed if o else None, outcomeSource=o.source if o else None,
                 surname=scored.loc[a.customer_id, "Surname"] if a.customer_id in scored.index else None,
                 segment=scored.loc[a.customer_id, "segment"] if a.customer_id in scored.index else None,
                 snapshot=json.loads(a.feature_snapshot) if a.feature_snapshot else None)
        out.append(d)
    return out
