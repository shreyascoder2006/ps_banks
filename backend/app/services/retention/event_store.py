"""Idempotent customer-event ingestion, retrieval and audit logging."""
import json
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from ...models import AuditLog, CustomerEvent

EVENT_TYPES = (
    "login", "transaction", "salary_credit", "balance_change", "product_usage",
    "complaint_logged", "complaint_resolved", "outreach_delivered",
)
SOURCES = ("ingested", "simulator")
LATE_AFTER = timedelta(days=2)  # event_ts older than this at ingestion => quality "late"


def audit(session: Session, actor: str, action: str, target: str, detail: Optional[dict] = None, on_chain: bool = False) -> None:
    session.add(AuditLog(actor=actor, action=action, target=target, detail=json.dumps(detail, default=str) if detail else None, on_chain=on_chain))


def ingest_event(session: Session, *, customer_id: int, event_type: str, event_ts: datetime,
                 source: str = "ingested", channel: Optional[str] = None, branch: Optional[str] = None,
                 amount: Optional[float] = None, balance_after: Optional[float] = None,
                 metadata: Optional[dict] = None, idempotency_key: Optional[str] = None,
                 scenario_run: Optional[str] = None, now: Optional[datetime] = None) -> tuple[CustomerEvent, bool]:
    """Insert one event. Returns (event, created). A repeated idempotency_key returns
    the original row with created=False instead of inserting a duplicate."""
    if event_type not in EVENT_TYPES:
        raise ValueError(f"unknown event_type '{event_type}'")
    if source not in SOURCES:
        raise ValueError(f"unknown source '{source}'")
    if event_ts.tzinfo is not None:
        event_ts = event_ts.astimezone().replace(tzinfo=None)
    now = now or datetime.utcnow()
    if event_ts > now + timedelta(minutes=5):
        raise ValueError("event_ts is in the future")

    if idempotency_key:
        existing = session.exec(select(CustomerEvent).where(CustomerEvent.idempotency_key == idempotency_key)).first()
        if existing:
            return existing, False

    quality = "late" if source == "ingested" and now - event_ts > LATE_AFTER else "ok"
    if amount is not None and abs(amount) > 1e9:
        quality = "suspect"
    ev = CustomerEvent(
        id=uuid.uuid4().hex, customer_id=customer_id, event_type=event_type, event_ts=event_ts, channel=channel,
        branch=branch, amount=amount, balance_after=balance_after,
        metadata_json=json.dumps(metadata) if metadata else None, source=source, scenario_run=scenario_run,
        idempotency_key=idempotency_key, ingested_at=now, quality=quality,
    )
    session.add(ev)
    session.commit()
    session.refresh(ev)
    return ev, True


def events_for(session: Session, customer_id: int, since: Optional[datetime] = None) -> list[CustomerEvent]:
    stmt = select(CustomerEvent).where(CustomerEvent.customer_id == customer_id).order_by(CustomerEvent.event_ts)
    if since:
        stmt = stmt.where(CustomerEvent.event_ts >= since)
    return list(session.exec(stmt).all())


def event_to_dict(e: CustomerEvent) -> dict:
    return {
        "id": e.id, "customerId": e.customer_id, "type": e.event_type, "at": e.event_ts.isoformat() + "Z",
        "channel": e.channel, "branch": e.branch, "amount": e.amount, "balanceAfter": e.balance_after,
        "metadata": json.loads(e.metadata_json) if e.metadata_json else None, "source": e.source,
        "scenarioRun": e.scenario_run, "quality": e.quality, "ingestedAt": e.ingested_at.isoformat() + "Z",
    }
