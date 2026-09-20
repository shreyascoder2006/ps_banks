"""Complaint inbox: real CFPB complaint narratives, relabelled for an
Indian banking demo (same approach the original Aurus frontend used), but
fetched server-side now instead of directly from the browser, and AI
analysis/draft-response calls use a server-held Groq key instead of a
`VITE_*` key shipped to the client bundle.
"""
import re
from datetime import datetime
from functools import lru_cache
from typing import Optional

import requests

from ..config import GROQ_API_KEY

CFPB_BASE = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/"

CATEGORY_MAP = {
    "ATM/Debit Card": "Checking or savings account",
    "Loan Grievance": "Mortgage",
    "Fraud/Unauthorized": "Checking or savings account",
    "Credit Card": "Credit card or prepaid card",
    "General": "Bank account or service",
}

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

_INDIAN_NAMES = [
    "Rajesh Mehta", "Priya Sharma", "Sunil Patil", "Fatima Shaikh",
    "Vikram Nair", "Anita Desai", "Ravi Kumar", "Sunita Gupta",
    "Mohammed Ansari", "Deepika Iyer", "Arjun Singh", "Kavitha Reddy",
]

_SEED_COMPLAINTS = [
    {
        "id": "CMP-0001", "customerName": "Rajesh Mehta", "accountNo": "SB-7823",
        "subject": "Unrecognized UPI Transaction - Fraud Report",
        "body": "I noticed a transaction of Rs 45,000 via UPI that I did not authorize. It happened overnight while I was asleep. I have blocked my card but the money is gone.",
        "channel": "email", "severity": "critical", "category": "Fraud", "status": "open", "slaHours": 4,
    },
    {
        "id": "CMP-0002", "customerName": "Anjali Desai", "accountNo": "SB-8822",
        "subject": "ATM Swallowed my Card", "body": "The branch ATM malfunctioned and captured my debit card. I need cash urgently and a replacement card.",
        "channel": "branch", "severity": "critical", "category": "ATM Service", "status": "open", "slaHours": 4,
    },
]


def _transform(cfpb: dict, index: int) -> dict:
    severity = SEVERITY_MAP.get(cfpb.get("issue", ""), ["critical", "high", "medium", "medium", "low"][index % 5])
    channel = CHANNEL_MAP.get(cfpb.get("submitted_via", ""), "portal")
    body = (cfpb.get("consumer_complaint_narrative") or "Complaint text unavailable")
    body = re.sub(r"X{2,}", "[REDACTED]", body)[:800]

    return {
        "id": f"CMP-{index + 1:04d}",
        "customerName": _INDIAN_NAMES[index % len(_INDIAN_NAMES)],
        "accountNo": f"SB-{1000 + index * 37 % 9000}",
        "subject": cfpb.get("issue") or "Banking Service Complaint",
        "body": body,
        "channel": channel,
        "severity": severity,
        "category": cfpb.get("product", "General"),
        "status": "open",
        "timestamp": cfpb.get("date_received", datetime.utcnow().isoformat()),
        "slaHours": SLA_HOURS[severity],
        "unread": True,
    }


@lru_cache(maxsize=1)
def load_complaints() -> list[dict]:
    try:
        results = []
        for category, size in [("Checking or savings account", 8), ("Mortgage", 5), ("Credit card or prepaid card", 5)]:
            params = {
                "product": CATEGORY_MAP.get(category, category),
                "has_narrative": "true",
                "size": str(size),
                "sort": "created_date_desc",
            }
            resp = requests.get(CFPB_BASE, params=params, timeout=8)
            resp.raise_for_status()
            hits = resp.json().get("hits", {}).get("hits", [])
            results.extend(h["_source"] for h in hits)

        filtered = [c for c in results if len(c.get("consumer_complaint_narrative") or "") > 50][:15]
        if not filtered:
            raise ValueError("no narratives returned")
        return [_transform(c, i) for i, c in enumerate(filtered)]
    except Exception:
        return _SEED_COMPLAINTS


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


def _groq_complete(system: str, user: str) -> Optional[str]:
    if not GROQ_API_KEY:
        return None
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "max_tokens": 512,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return None


def analyze_complaint(complaint: dict) -> dict:
    result = _groq_complete("You are a JSON-only banking complaint analyzer.", PROMPT_ANALYZE.format(**complaint))
    if result:
        import json
        try:
            cleaned = result.strip().strip("`").removeprefix("json").strip()
            return {**json.loads(cleaned), "source": "groq"}
        except Exception:
            pass
    return {
        "summary": f"{complaint['category']} complaint from {complaint['customerName']}.",
        "severity": complaint["severity"],
        "sentimentScore": 0.3 if complaint["severity"] in ("critical", "high") else 0.5,
        "keyIssues": [complaint["subject"]],
        "regulatoryRisk": "high" if complaint["severity"] == "critical" else "low",
        "recommendedAction": "Escalate to relationship manager" if complaint["severity"] in ("critical", "high") else "Standard queue processing",
        "source": "fallback-no-groq-key",
    }


def draft_response(complaint: dict) -> dict:
    result = _groq_complete("You are a banking customer service agent.", PROMPT_DRAFT.format(name=complaint["customerName"], body=complaint["body"]))
    if result:
        return {"draft": result.strip(), "source": "groq"}
    return {
        "draft": (
            f"Dear {complaint['customerName']}, thank you for bringing this to our attention. "
            f"We have logged your case ({complaint['id']}) and a representative will follow up within "
            f"{complaint['slaHours']} hours. If this involves an unauthorized transaction, RBI zero-liability "
            f"guidelines apply and you will not bear the loss if reported promptly. Reach us at 1800-XXX-XXXX for updates."
        ),
        "source": "fallback-no-groq-key",
    }
