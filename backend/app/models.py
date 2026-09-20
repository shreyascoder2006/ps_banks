from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Complaint(SQLModel, table=True):
    id: str = Field(primary_key=True)
    customer_id: int = Field(index=True)
    customer_name: str
    account_no: str
    subject: str
    body: str
    channel: str
    severity: str
    category: str
    status: str = Field(default="open", index=True)
    sla_hours: int
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None
    assignee: Optional[str] = None
    escalation_reason: Optional[str] = None

    ai_summary: Optional[str] = None
    ai_sentiment: Optional[float] = None
    ai_key_issues: Optional[str] = None  # JSON-encoded list
    ai_regulatory_risk: Optional[str] = None
    ai_recommended_action: Optional[str] = None
    ai_source: Optional[str] = None

    draft_response: Optional[str] = None
    draft_source: Optional[str] = None


class ComplaintMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    complaint_id: str = Field(index=True)
    author: str  # customer | agent | system
    body: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class OutreachAction(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    customer_id: int = Field(index=True)
    channel: str
    offer_type: str
    message: str
    reason: str
    risk_score_at_trigger: float
    triggered_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    audit_tx_hash: Optional[str] = None
    audit_status: Optional[str] = None


class CustomerSignal(SQLModel, table=True):
    """Live behavioural signals layered on top of the static dataset so
    risk scores can actually move at runtime (activity drop-offs, balance
    changes). Written by the demo simulator and by real actions; every
    row is labelled with its source."""
    customer_id: int = Field(primary_key=True)
    is_active_member: Optional[int] = None
    balance: Optional[float] = None
    source: str = "simulator"
    note: Optional[str] = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class OutreachOutcome(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    action_id: int = Field(index=True)
    outcome: str  # retained | churned | no_response
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
