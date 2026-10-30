from datetime import datetime
from typing import Optional

from pydantic import NaiveDatetime
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
    created_at: NaiveDatetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[NaiveDatetime] = None
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
    created_at: NaiveDatetime = Field(default_factory=datetime.utcnow)


class OutreachAction(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    customer_id: int = Field(index=True)
    channel: str
    offer_type: str
    message: str
    reason: str
    risk_score_at_trigger: float
    triggered_by: str
    created_at: NaiveDatetime = Field(default_factory=datetime.utcnow)
    audit_tx_hash: Optional[str] = None
    audit_status: Optional[str] = None
    # --- v2 lifecycle (all nullable/defaulted so existing rows stay valid) ---
    status: str = Field(default="executed", index=True)  # recommended|approved|queued|attempted|delivered|failed|withheld|executed
    simulated: bool = True  # True => no real message left the system; DB record only
    approved_by: Optional[str] = None
    approved_at: Optional[NaiveDatetime] = None
    campaign: str = "retention-v1"
    experiment_group: str = "treatment"  # treatment | holdout (holdout = deliberately not contacted)
    observation_days: int = 30
    feature_snapshot: Optional[str] = None  # JSON: pre-action features + score + recommendation


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
    updated_at: NaiveDatetime = Field(default_factory=datetime.utcnow)


class OutreachOutcome(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    action_id: int = Field(index=True)
    outcome: str  # retained | churned | no_response
    notes: Optional[str] = None
    source: str = "manual"  # manual | system | simulator
    observed: bool = True  # False => simulated outcome; excluded from training and experiment stats
    recorded_by: Optional[str] = None
    created_at: NaiveDatetime = Field(default_factory=datetime.utcnow)

class CustomerEvent(SQLModel, table=True):
    """Timestamped behavioural event. The churn dataset has no event history, so
    every row is either `ingested` (a real feed) or `simulator` (demo/scenario)."""
    id: str = Field(primary_key=True)
    customer_id: int = Field(index=True)
    event_type: str = Field(index=True)  # login|transaction|salary_credit|balance_change|product_usage|complaint_logged|complaint_resolved|outreach_delivered
    event_ts: NaiveDatetime = Field(index=True)
    channel: Optional[str] = None
    branch: Optional[str] = None
    amount: Optional[float] = None
    balance_after: Optional[float] = None
    metadata_json: Optional[str] = None
    source: str = "ingested"  # ingested | simulator
    scenario_run: Optional[str] = Field(default=None, index=True)
    idempotency_key: Optional[str] = Field(default=None, index=True, unique=True)
    ingested_at: NaiveDatetime = Field(default_factory=datetime.utcnow)
    quality: str = "ok"  # ok | late | suspect


class Alert(SQLModel, table=True):
    id: str = Field(primary_key=True)  # ALT-000001
    customer_id: int = Field(index=True)
    severity: str = Field(index=True)  # critical | high | medium
    risk_score: float
    prev_risk_score: Optional[float] = None
    trigger: str = Field(index=True)  # high_risk | risk_jump | inactivity | balance_decline | complaint_spike
    trigger_ts: NaiveDatetime = Field(default_factory=datetime.utcnow)
    explanation: str = ""  # JSON list of human-readable reasons
    evidence: str = ""  # JSON: windows + feature values behind the trigger
    data_source: str = "model"  # model | events | simulator
    quality: str = "ok"  # ok | sparse (little event history) | proxy (relies on proxy fields)
    recommended_action: Optional[str] = None
    status: str = Field(default="open", index=True)  # open|acknowledged|in_progress|resolved|dismissed
    assignee: Optional[str] = None
    dedupe_key: str = Field(index=True)
    scenario_run: Optional[str] = Field(default=None, index=True)
    created_at: NaiveDatetime = Field(default_factory=datetime.utcnow)
    updated_at: NaiveDatetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[NaiveDatetime] = None
    resolution_reason: Optional[str] = None


class AlertHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    alert_id: str = Field(index=True)
    at: NaiveDatetime = Field(default_factory=datetime.utcnow)
    actor: str
    from_status: Optional[str] = None
    to_status: str
    note: Optional[str] = None


class ContactPreference(SQLModel, table=True):
    """Consent / opt-out per channel. No consent data exists in the source dataset;
    absence of a row means `unknown` and is treated as permitted only for
    in-app/email/sms/call in the demo, flagged as `assumed` in recommendations."""
    customer_id: int = Field(primary_key=True)
    opt_out_all: bool = False
    opt_out_channels: str = ""  # comma-separated channel names
    updated_by: Optional[str] = None
    updated_at: NaiveDatetime = Field(default_factory=datetime.utcnow)


class AuditLog(SQLModel, table=True):
    """Database audit trail (distinct from the optional on-chain record)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    at: NaiveDatetime = Field(default_factory=datetime.utcnow, index=True)
    actor: str
    action: str = Field(index=True)
    target: str
    detail: Optional[str] = None
    on_chain: bool = False


class RiskSnapshot(SQLModel, table=True):
    """Point-in-time risk score for a customer, written whenever the customer is
    (re)evaluated. Gives alerts a real `previous score` and powers trajectories."""
    id: Optional[int] = Field(default=None, primary_key=True)
    customer_id: int = Field(index=True)
    at: NaiveDatetime = Field(default_factory=datetime.utcnow, index=True)
    score: float
    level: str
    source: str = "model"  # model | simulator
    scenario_run: Optional[str] = Field(default=None, index=True)


class BookSnapshot(SQLModel, table=True):
    """Aggregate monitored-book risk at a moment in time (for the Overview trend)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    at: NaiveDatetime = Field(default_factory=datetime.utcnow, index=True)
    monitored: int
    avg_risk: float
    critical: int
    high: int
    medium: int
    low: int
    exposure_at_risk: float  # balance held by critical+high customers


class ScenarioRun(SQLModel, table=True):
    run_id: str = Field(primary_key=True)
    scenario: str
    seed: int
    customer_id: int
    step: int = 0
    created_by: str
    created_at: NaiveDatetime = Field(default_factory=datetime.utcnow)
    anchor: NaiveDatetime = Field(default_factory=datetime.utcnow)
