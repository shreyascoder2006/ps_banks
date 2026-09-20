"""Complaint inbox backed by SQLite.

Complaint narratives are real CFPB (US) consumer-complaint text (fetched
server-side at first boot, with a small seed fallback). Each complaint is
linked to a real CustomerId from the churn dataset - preferentially the
highest-risk customers, so complaint history and churn risk tell one
coherent story in the Customer 360 view. Names/account numbers come from
the linked customer record rather than a random relabel.

AI analysis / draft-response use a server-held Groq key and their result
is persisted on the complaint row (with a `source` tag so the UI never
presents a fallback as a model output).
"""
import json
import re
from datetime import datetime
from typing import Optional

import requests
from sqlmodel import Session, select

from .llm import complete
from ..models import Complaint, ComplaintMessage
from .blockchain import record_event
from .churn import score_all_customers
from .events import publish

CFPB_BASE = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/"

SEVERITY_MAP = {
    "Fraud or scam": "critical",
    "Unauthorized transactions/Unauthorized transfers": "critical",
    "Problem with a lender or other company charging your account": "high",
    "Closing an account": "high",
    "Managing an account": "medium",
    "Opening an account": "low",
}
CHANNEL_MAP = {"Web": "portal", "Phone": "ivr", "Referral": "branch", "Email": "email", "Postal mail": "email", "Fax": "email"}
SLA_HOURS = {"critical": 4, "high": 24, "medium": 72, "low": 168}
VALID_STATUSES = ("open", "in_progress", "escalated", "resolved")

_SEED_NARRATIVES = [
    ("Unrecognized UPI Transaction - Fraud Report", "Fraud", "email", "critical",
     "I noticed a transaction of Rs 45,000 via UPI that I did not authorize. It happened overnight while I was asleep. I have blocked my card but the money is gone."),
    ("ATM Swallowed my Card", "ATM Service", "branch", "critical",
     "The branch ATM malfunctioned and captured my debit card. I need cash urgently and a replacement card."),
    ("Double EMI Deduction", "Loan", "portal", "high",
     "My loan EMI was deducted twice this month, once on the 5th and again on the 7th. Please refund the duplicate amount immediately."),
    ("KYC Aadhaar Rejection Loop", "KYC", "ivr", "high",
     "Video KYC keeps rejecting with 'Aadhaar mismatch' even though the only difference is a space in my name. My account is at risk of freezing."),
    ("Net Banking Session Timeout", "Digital Channels", "portal", "medium",
     "Net banking logs me out every 2 minutes so I cannot complete a fund transfer. Tried Chrome and Edge."),
    ("FD Premature Closure Query", "Fixed Deposit", "email", "medium",
     "I want to close my FD prematurely. What are the penalty charges? The website FAQ is unclear."),
    ("Address Update Request", "Service Request", "email", "low",
     "I have moved. Please update my communication address; proof attached in the previous mail."),
    ("Account Statement Request", "Service Request", "portal", "low",
     "Please send my account statement for the last financial year for tax filing, PDF preferred."),
]


def _fetch_cfpb() -> list[dict]:
    results = []
    for product, size in [("Checking or savings account", 8), ("Mortgage", 5), ("Credit card or prepaid card", 5)]:
        params = {"product": product, "has_narrative": "true", "size": str(size), "sort": "created_date_desc"}
        resp = requests.get(CFPB_BASE, params=params, timeout=8)
        resp.raise_for_status()
        results.extend(h["_source"] for h in resp.json().get("hits", {}).get("hits", []))
    filtered = [c for c in results if len(c.get("consumer_complaint_narrative") or "") > 50][:15]
    if not filtered:
        raise ValueError("no narratives returned")
    out = []
    for i, c in enumerate(filtered):
        severity = SEVERITY_MAP.get(c.get("issue", ""), ["critical", "high", "medium", "medium", "low"][i % 5])
        body = re.sub(r"X{2,}", "[REDACTED]", c.get("consumer_complaint_narrative") or "")[:800]
        out.append({
            "subject": c.get("issue") or "Banking Service Complaint",
            "category": c.get("product", "General"),
            "channel": CHANNEL_MAP.get(c.get("submitted_via", ""), "portal"),
            "severity": severity,
            "body": body,
        })
    return out


def seed_complaints_if_empty(session: Session) -> int:
    if session.exec(select(Complaint).limit(1)).first():
        return 0

    try:
        narratives = _fetch_cfpb()
    except Exception:
        narratives = [
            {"subject": s, "category": cat, "channel": ch, "severity": sev, "body": body}
            for s, cat, ch, sev, body in _SEED_NARRATIVES
        ]

    # Link to the highest-risk real customers so complaint history and churn
    # risk line up in the Customer 360 view.
    scored = score_all_customers().sort_values("churn_risk_score", ascending=False)
    targets = scored.head(len(narratives))

    created = 0
    for i, (narr, (_, cust)) in enumerate(zip(narratives, targets.iterrows())):
        complaint = Complaint(
            id=f"CMP-{i + 1:04d}",
            customer_id=int(cust["CustomerId"]),
            customer_name=str(cust["Surname"]),
            account_no=str(cust["account_no"]),
            subject=narr["subject"],
            body=narr["body"],
            channel=narr["channel"],
            severity=narr["severity"],
            category=narr["category"],
            sla_hours=SLA_HOURS[narr["severity"]],
        )
        session.add(complaint)
        session.add(ComplaintMessage(complaint_id=complaint.id, author="customer", body=narr["body"]))
        created += 1
    session.commit()
    return created


def iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """DB datetimes are naive UTC; emit an explicit Z so browsers don't
    parse them as local time."""
    return dt.isoformat() + "Z" if dt else None


def to_dict(c: Complaint) -> dict:
    return {
        "id": c.id,
        "customerId": c.customer_id,
        "customerName": c.customer_name,
        "accountNo": c.account_no,
        "subject": c.subject,
        "body": c.body,
        "channel": c.channel,
        "severity": c.severity,
        "category": c.category,
        "status": c.status,
        "slaHours": c.sla_hours,
        "timestamp": iso_utc(c.created_at),
        "resolvedAt": iso_utc(c.resolved_at),
        "assignee": c.assignee,
        "escalationReason": c.escalation_reason,
        "aiAnalysis": (
            {
                "summary": c.ai_summary,
                "sentimentScore": c.ai_sentiment,
                "keyIssues": json.loads(c.ai_key_issues) if c.ai_key_issues else [],
                "regulatoryRisk": c.ai_regulatory_risk,
                "recommendedAction": c.ai_recommended_action,
                "source": c.ai_source,
            }
            if c.ai_summary
            else None
        ),
        "draftResponse": {"draft": c.draft_response, "source": c.draft_source} if c.draft_response else None,
    }


PROMPT_ANALYZE = """You are an AI banking assistant. Analyze the following complaint and return ONLY a JSON object:
{{"summary": "1 sentence", "severity": "low|medium|high|critical", "sentimentScore": 0.0-1.0, "keyIssues": ["a","b","c"], "regulatoryRisk": "none|low|medium|high", "recommendedAction": "string"}}
Rules: severity is critical if fraud/unauthorized or >Rs 50,000 or ombudsman threat. regulatoryRisk is high if RBI guidelines apply (unauthorized txn, ombudsman).

Complaint subject: {subject}
Complaint body: {body}
"""

PROMPT_DRAFT = """You are a professional Indian bank customer service agent. Draft a response to the customer below.
Rules: address them by name, be empathetic but professional, fewer than 180 words, never start with "We apologize for the inconvenience", mention RBI zero-liability for unauthorized transactions if relevant, end with a specific commitment and contact number (1800-XXX-XXXX).

Customer: {name}
Complaint: {body}
"""


def analyze_complaint(session: Session, c: Complaint) -> dict:
    result, tag = complete("You are a JSON-only banking complaint analyzer. Output raw JSON, no markdown fences.", PROMPT_ANALYZE.format(subject=c.subject, body=c.body), max_tokens=400)
    analysis = None
    if result:
        try:
            start, end = result.find("{"), result.rfind("}")
            analysis = {**json.loads(result[start:end + 1]), "source": tag}
        except Exception:
            analysis = None
    if analysis is None:
        analysis = {
            "summary": f"{c.category} complaint from {c.customer_name}.",
            "severity": c.severity,
            "sentimentScore": 0.3 if c.severity in ("critical", "high") else 0.5,
            "keyIssues": [c.subject],
            "regulatoryRisk": "high" if c.severity == "critical" else "low",
            "recommendedAction": "Escalate to relationship manager" if c.severity in ("critical", "high") else "Standard queue processing",
            "source": tag if tag.startswith("fallback") else "fallback-parse-error",
        }

    c.ai_summary = analysis.get("summary")
    c.ai_sentiment = analysis.get("sentimentScore")
    c.ai_key_issues = json.dumps(analysis.get("keyIssues", []))
    c.ai_regulatory_risk = analysis.get("regulatoryRisk")
    c.ai_recommended_action = analysis.get("recommendedAction")
    c.ai_source = analysis["source"]
    if analysis["source"] in ("groq", "gemini") and analysis.get("severity") in SLA_HOURS:
        c.severity = analysis["severity"]
        c.sla_hours = SLA_HOURS[c.severity]
    session.add(c)
    session.commit()
    return analysis


def draft_response(session: Session, c: Complaint) -> dict:
    result, tag = complete("You are a banking customer service agent.", PROMPT_DRAFT.format(name=c.customer_name, body=c.body), max_tokens=400)
    if result:
        draft = {"draft": result.strip(), "source": tag}
    else:
        draft = {
            "draft": (
                f"Dear {c.customer_name}, thank you for bringing this to our attention. "
                f"We have logged your case ({c.id}) and a representative will follow up within "
                f"{c.sla_hours} hours. If this involves an unauthorized transaction, RBI zero-liability "
                f"guidelines apply and you will not bear the loss if reported promptly. Reach us at 1800-XXX-XXXX for updates."
            ),
            "source": tag,
        }
    c.draft_response = draft["draft"]
    c.draft_source = draft["source"]
    session.add(c)
    session.commit()
    return draft


def update_status(session: Session, c: Complaint, status: str, actor: str, note: Optional[str] = None) -> dict:
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status '{status}'")
    previous = c.status
    c.status = status
    if status == "resolved":
        c.resolved_at = datetime.utcnow()
    if status == "escalated" and note:
        c.escalation_reason = note
    session.add(c)
    session.add(ComplaintMessage(
        complaint_id=c.id, author="system",
        body=f"Status changed {previous} -> {status} by {actor}" + (f": {note}" if note else ""),
    ))
    session.commit()

    audit = None
    if status == "resolved":
        audit = record_event(
            "complaint_resolution",
            f"{c.id} resolved by {actor}",
            json.dumps({"id": c.id, "customer_id": c.customer_id, "resolved_at": c.resolved_at.isoformat(), "actor": actor, "note": note}),
        )
    publish(
        "complaint_status",
        f"{c.id} ({c.customer_name}) {previous.replace('_', ' ')} -> {status.replace('_', ' ')} by {actor}",
        severity=c.severity if status == "escalated" else ("low" if status == "resolved" else None),
        ref={"complaintId": c.id, "customerId": c.customer_id},
        data={"status": status, "previous": previous, "audit": audit},
    )
    return {"complaint": to_dict(c), "audit": audit}


def add_message(session: Session, c: Complaint, author: str, body: str) -> ComplaintMessage:
    msg = ComplaintMessage(complaint_id=c.id, author=author, body=body)
    session.add(msg)
    if c.status == "open" and author == "agent":
        c.status = "in_progress"
        session.add(c)
    session.commit()
    session.refresh(msg)
    publish("complaint_message", f"{author} replied on {c.id}", ref={"complaintId": c.id, "customerId": c.customer_id}, data={"author": author, "body": body})
    return msg
