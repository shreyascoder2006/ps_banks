"""Banking assistant: merges the original Aurus "Policy Assistant" (RAG over
RBI circular PDFs via Groq) with the original Outliers `crm/assistant.py`
intent-detection, into one assistant that can answer both "what does RBI
policy say" and "what's this customer's churn risk / segment" questions.

The RBI PDFs are parsed server-side once (cached) instead of being fetched
and parsed with pdf.js in the browser on every session.
"""
import re
from functools import lru_cache
from typing import Any, Dict, Optional, Tuple

import requests
from pypdf import PdfReader

from ..config import DOCS_DIR
from .llm import complete, provider

DOC_FILES = [
    ("rbi_customer_service.pdf", "RBI Master Circular on Customer Service"),
    ("rbi_grievance_redressal.pdf", "RBI Grievance Redressal Guidelines"),
]

POLICY_SYSTEM = """You are a knowledgeable banking policy assistant for Indian bank branch staff. You have access to RBI Master Circulars and banking guidelines below.
Rules:
- Answer in the same language the user asked in.
- Keep answers concise (3-5 sentences) unless asked for more detail.
- Always end with 'Source: [document name]'.
- For unauthorized transaction queries always mention RBI zero-liability rules.
- For complaint queries always mention the 30-day resolution mandate.
- If unsure, say so - never invent policy."""

_INTENTS = {
    "lead_management": ["lead", "prospect", "qualify"],
    "churn": ["churn", "retention", "at-risk", "cancel"],
    "segment": ["segment", "rfm", "champion", "loyal"],
    "forecast": ["forecast", "growth", "projection"],
    "complaint": ["complaint", "grievance", "ticket"],
    "policy": ["rbi", "policy", "circular", "regulation", "ombudsman", "kyc", "zero-liability"],
}


@lru_cache(maxsize=1)
def load_policy_text() -> Dict[str, Any]:
    combined = ""
    sources = []
    for filename, label in DOC_FILES:
        path = DOCS_DIR / filename
        if not path.exists():
            continue
        try:
            reader = PdfReader(str(path))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            combined += f"\n--- START OF DOCUMENT: {label} ---\n{text}\n--- END ---\n"
            sources.append(label)
        except Exception:
            continue
    return {"text": combined[:15000], "sources": sources}


def detect_intent(query: str) -> Tuple[str, float]:
    q = query.lower()
    scores = {intent: sum(1 for kw in kws if kw in q) / len(kws) for intent, kws in _INTENTS.items()}
    scores = {k: v for k, v in scores.items() if v > 0}
    if not scores:
        return "general", 0.5
    best = max(scores.items(), key=lambda kv: kv[1])
    return best[0], min(best[1], 1.0)


def answer_query(query: str, history: Optional[list] = None) -> Dict[str, Any]:
    intent, confidence = detect_intent(query)
    docs = load_policy_text()

    if intent == "policy" or provider() is None:
        hist = [
            {"role": "user", "content": f"RBI Policy Documents:\n\n{docs['text']}\n\n---\nAnswer using these."},
            {"role": "assistant", "content": "Understood, ready to assist with policy-grounded answers."},
            *([{"role": m["role"], "content": m["content"]} for m in history] if history else []),
        ]
        answer, tag = complete(POLICY_SYSTEM, query, max_tokens=700, history=hist)
        if answer:
            return {"answer": answer, "intent": intent, "confidence": confidence, "sources": docs["sources"], "source": tag}
        return {
            "answer": (
                "AI assistant is not configured (no LLM key set on the server), so I can't generate a "
                "grounded answer right now. For unauthorized transactions, RBI's zero-liability circular applies; "
                "for complaints, the mandated resolution window is 30 days. Set GROQ_API_KEY or GEMINI_API_KEY in backend/.env."
            ),
            "intent": intent, "confidence": confidence, "sources": docs["sources"], "source": tag,
        }

    # Non-policy intents get a structured, grounded (non-hallucinated) answer.
    answer_map = {
        "churn": "I can help assess churn risk - check the Churn Pulse dashboard for model-scored risk and drivers per customer.",
        "segment": "I can help with RFM segmentation - see the Segments tab for Champions/Loyal/At-Risk groupings and recommended offers.",
        "forecast": "I can help with growth projections - see the Forecast tab for the tenure-cohort based customer growth trend.",
        "complaint": "I can help with complaint handling - open the Resolve tab to view the inbox, AI analysis, and draft responses.",
        "general": "I can answer RBI policy questions, or point you to churn risk, segmentation, forecasts, or the complaint inbox. What do you need?",
    }
    return {
        "answer": answer_map.get(intent, answer_map["general"]),
        "intent": intent, "confidence": confidence, "sources": [], "source": "rule-based",
    }
