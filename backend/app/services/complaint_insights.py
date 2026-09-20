"""PS5 analytics on top of the complaint store: ingest with auto-triage,
related/duplicate detection, trend + root-cause rollups, and a regulatory
export whose hash is written to the audit chain.

Duplicate detection and root-cause terms use TF-IDF over the real
complaint text (scikit-learn, already a dependency) — no LLM required, so
they work identically with or without a Groq key. The optional Groq
narrative on top is tagged with its source like everything else.
"""
import csv
import io
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlmodel import Session, select

from .llm import complete
from ..data.loader import load_customers
from ..models import Complaint, ComplaintMessage
from .blockchain import record_event
from .complaints import SLA_HOURS, analyze_complaint, to_dict
from .events import publish

_SEVERITY_KEYWORDS = {
    "critical": ["fraud", "unauthori", "stolen", "hack", "ombudsman", "police", "scam", "lost money"],
    "high": ["double", "deducted twice", "emi", "freez", "blocked", "kyc", "loan", "penalty", "urgent"],
    "medium": ["timeout", "slow", "app", "net banking", "login", "otp", "statement", "fd", "interest"],
}
_CATEGORY_KEYWORDS = {
    "Fraud": ["fraud", "unauthori", "scam", "stolen", "hack"],
    "ATM Service": ["atm", "cash withdrawal", "card captured", "swallowed"],
    "Loan": ["emi", "loan", "mortgage", "interest rate"],
    "KYC": ["kyc", "aadhaar", "pan", "verification"],
    "Digital Channels": ["net banking", "app", "login", "otp", "upi", "timeout"],
    "Fixed Deposit": ["fd", "fixed deposit", "maturity"],
    "Credit Card": ["credit card", "card limit", "annual fee"],
    "Service Request": ["address", "statement", "cheque", "update"],
}


def _guess(text: str, table: dict, default: str) -> str:
    t = text.lower()
    for label, kws in table.items():
        if any(k in t for k in kws):
            return label
    return default


def _next_id(session: Session) -> str:
    ids = session.exec(select(Complaint.id)).all()
    n = max((int(i.split("-")[1]) for i in ids if i.startswith("CMP-")), default=0)
    return f"CMP-{n + 1:04d}"


def create_complaint(session: Session, customer_id: int, subject: str, body: str, channel: str,
                     severity: Optional[str] = None, category: Optional[str] = None, auto_analyze: bool = True) -> dict:
    customers = load_customers()
    row = customers[customers["CustomerId"] == customer_id]
    if row.empty:
        raise KeyError(f"Customer {customer_id} not found")
    row = row.iloc[0]

    text = f"{subject} {body}"
    severity = severity if severity in SLA_HOURS else _guess(text, _SEVERITY_KEYWORDS, "low")
    category = category or _guess(text, _CATEGORY_KEYWORDS, "General")

    c = Complaint(
        id=_next_id(session),
        customer_id=customer_id,
        customer_name=str(row["Surname"]),
        account_no=str(row["account_no"]),
        subject=subject,
        body=body,
        channel=channel,
        severity=severity,
        category=category,
        sla_hours=SLA_HOURS[severity],
    )
    session.add(c)
    session.add(ComplaintMessage(complaint_id=c.id, author="customer", body=body))
    session.commit()
    session.refresh(c)

    analysis = analyze_complaint(session, c) if auto_analyze else None
    related = related_complaints(session, c.id)
    d = to_dict(c)
    publish(
        "complaint_logged",
        f"New {d['severity']} complaint via {channel}: {d['customerName']} - {subject}",
        severity=d["severity"], ref={"complaintId": c.id, "customerId": customer_id, "branch": str(row["branch"])},
        data={"complaint": d, "related": related},
    )
    return {"complaint": d, "analysis": analysis, "related": related}


def _corpus(session: Session) -> tuple[list[Complaint], list[str]]:
    complaints = session.exec(select(Complaint)).all()
    return complaints, [f"{c.subject}. {c.body}" for c in complaints]


def related_complaints(session: Session, complaint_id: str, top_k: int = 3, threshold: float = 0.12) -> list[dict]:
    complaints, docs = _corpus(session)
    if len(complaints) < 2:
        return []
    idx = next((i for i, c in enumerate(complaints) if c.id == complaint_id), None)
    if idx is None:
        return []
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=1)
    X = vec.fit_transform(docs)
    sims = cosine_similarity(X[idx], X).ravel()
    order = [i for i in np.argsort(-sims) if i != idx and sims[i] >= threshold][:top_k]
    out = []
    for i in order:
        c = complaints[i]
        out.append({
            "id": c.id, "customerId": c.customer_id, "customerName": c.customer_name, "subject": c.subject,
            "category": c.category, "severity": c.severity, "status": c.status,
            "similarity": round(float(sims[i]), 3),
            "sameCustomer": c.customer_id == complaints[idx].customer_id,
        })
    return out


def _sla_breached(c: Complaint, now: datetime) -> bool:
    if c.status == "resolved":
        return c.resolved_at is not None and c.resolved_at > c.created_at + timedelta(hours=c.sla_hours)
    return now > c.created_at + timedelta(hours=c.sla_hours)


def trends(session: Session) -> dict:
    complaints, docs = _corpus(session)
    now = datetime.utcnow()

    by_category = Counter(c.category for c in complaints)
    by_severity = Counter(c.severity for c in complaints)
    by_channel = Counter(c.channel for c in complaints)
    by_status = Counter(c.status for c in complaints)

    weekly = defaultdict(int)
    for c in complaints:
        week_start = (c.created_at - timedelta(days=c.created_at.weekday())).date()
        weekly[week_start.isoformat()] += 1

    resolved = [c for c in complaints if c.status == "resolved" and c.resolved_at]
    avg_resolution_hours = (
        round(sum((c.resolved_at - c.created_at).total_seconds() for c in resolved) / len(resolved) / 3600, 1)
        if resolved else None
    )
    breached = [c for c in complaints if _sla_breached(c, now)]

    # Root-cause terms per category: top TF-IDF terms across that category's text.
    root_causes = {}
    if len(docs) >= 2:
        vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=1, max_features=2000)
        X = vec.fit_transform(docs)
        terms = np.array(vec.get_feature_names_out())
        for cat in by_category:
            rows = [i for i, c in enumerate(complaints) if c.category == cat]
            mean_vec = np.asarray(X[rows].mean(axis=0)).ravel()
            top = terms[np.argsort(-mean_vec)[:5]]
            root_causes[cat] = [t for t in top if mean_vec[list(terms).index(t)] > 0]

    sentiments = [c.ai_sentiment for c in complaints if c.ai_sentiment is not None]

    return {
        "total": len(complaints),
        "by_category": dict(by_category.most_common()),
        "by_severity": dict(by_severity),
        "by_channel": dict(by_channel),
        "by_status": dict(by_status),
        "weekly_volume": dict(sorted(weekly.items())),
        "sla_breached": len(breached),
        "sla_breach_rate": round(len(breached) / len(complaints), 3) if complaints else 0,
        "avg_resolution_hours": avg_resolution_hours,
        "avg_ai_sentiment": round(float(np.mean(sentiments)), 3) if sentiments else None,
        "root_cause_terms": root_causes,
        "narrative": _root_cause_narrative(by_category, root_causes, len(breached)),
    }


def _root_cause_narrative(by_category: Counter, root_causes: dict, breached: int) -> dict:
    prompt = (
        "You are a bank's complaints analyst. In 3 sentences, identify the most likely root causes and one concrete fix, "
        f"given complaint counts by category {dict(by_category)} and the most distinctive terms per category {root_causes}. "
        f"{breached} complaints have breached SLA. Be specific, no filler."
    )
    out, tag = complete("", prompt, max_tokens=250)
    if out:
        return {"text": out, "source": tag}
    top = by_category.most_common(2)
    return {"text": "Top complaint categories: " + ", ".join(f"{k} ({v})" for k, v in top) + f". {breached} case(s) have breached SLA.", "source": "rule-based"}


def regulatory_export(session: Session, actor: str) -> dict:
    """Cases that matter to RBI reporting: SLA-breached, escalated, or
    critical with high regulatory risk. Returns CSV text and writes its
    hash on-chain so the report itself is tamper-evident."""
    complaints = session.exec(select(Complaint)).all()
    now = datetime.utcnow()
    rows = []
    for c in complaints:
        breached = _sla_breached(c, now)
        reportable = breached or c.status == "escalated" or (c.severity == "critical" and c.ai_regulatory_risk == "high")
        if not reportable:
            continue
        rows.append({
            "complaint_id": c.id, "customer_id": c.customer_id, "account_no": c.account_no,
            "category": c.category, "severity": c.severity, "status": c.status, "channel": c.channel,
            "received_at": c.created_at.isoformat(), "sla_hours": c.sla_hours,
            "sla_breached": breached, "resolved_at": c.resolved_at.isoformat() if c.resolved_at else "",
            "regulatory_risk": c.ai_regulatory_risk or "", "escalation_reason": c.escalation_reason or "",
            "ombudsman_eligible": breached and (now - c.created_at) > timedelta(days=30),
        })

    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    csv_text = buf.getvalue()

    audit = record_event(
        "regulatory_report",
        f"Complaint regulatory export ({len(rows)} cases) by {actor}",
        csv_text or json.dumps({"empty": True, "generated_at": now.isoformat()}),
    )
    publish("regulatory_export", f"Regulatory export generated ({len(rows)} cases) by {actor}", data={"audit": audit, "caseCount": len(rows)})
    return {"generated_at": now.isoformat(), "case_count": len(rows), "csv": csv_text, "audit": audit}
