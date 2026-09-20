"""PS6 - Frontline desk multilingual assistant.

Speech-to-text and text-to-speech run in the browser (Web Speech API, no
keys, no audio leaves the device). This module does the language work
that needs a model: banking-aware translation with a glossary so product
names and jargon stay consistent, per-language process guides, and a
bilingual interaction summary for the record.

Every response carries a `source` tag; without a Groq key the endpoints
return honest fallbacks (untranslated text clearly labelled) rather than
pretending to translate.
"""
from functools import lru_cache
from typing import Optional

import requests

from ..config import GROQ_API_KEY

LANGUAGES = {
    "en-IN": "English", "hi-IN": "Hindi", "mr-IN": "Marathi", "ta-IN": "Tamil", "te-IN": "Telugu",
    "bn-IN": "Bengali", "gu-IN": "Gujarati", "kn-IN": "Kannada", "ml-IN": "Malayalam", "pa-IN": "Punjabi",
}

# Glossary keeps banking terms consistent across turns. Hindi equivalents
# are given explicitly; for other languages the model is told to use the
# standard banking term and keep English product names where customary.
GLOSSARY = {
    "savings account": "बचत खाता",
    "current account": "चालू खाता",
    "fixed deposit": "सावधि जमा (FD)",
    "recurring deposit": "आवर्ती जमा (RD)",
    "loan": "ऋण",
    "EMI": "किस्त (EMI)",
    "interest rate": "ब्याज दर",
    "balance": "शेष राशि",
    "statement": "खाता विवरण",
    "cheque book": "चेक बुक",
    "debit card": "डेबिट कार्ड",
    "credit card": "क्रेडिट कार्ड",
    "net banking": "नेट बैंकिंग",
    "UPI": "UPI",
    "KYC": "केवाईसी (KYC)",
    "Aadhaar": "आधार",
    "PAN": "पैन (PAN)",
    "branch": "शाखा",
    "complaint": "शिकायत",
    "ombudsman": "बैंकिंग लोकपाल",
    "nominee": "नामांकित व्यक्ति",
    "zero-liability": "शून्य दायित्व",
}

PROCESS_GUIDES = {
    "account_opening": {
        "title": "Savings account opening",
        "steps": [
            "Confirm the customer's full name, date of birth and mobile number.",
            "Collect KYC: Aadhaar and PAN (or Form 60 if no PAN).",
            "Capture a live photograph and signature.",
            "Explain minimum balance, debit card and net banking options.",
            "Add a nominee and confirm communication address.",
            "Submit the form; account number and welcome kit issued within 2 working days.",
        ],
    },
    "loan_enquiry": {
        "title": "Home / personal loan enquiry",
        "steps": [
            "Ask the loan purpose, amount and preferred tenure.",
            "Check eligibility: income proof, existing EMIs, credit score.",
            "Explain interest rate type (fixed / floating) and processing fee.",
            "Share the EMI estimate for the requested amount and tenure.",
            "List documents: ID, address proof, 6 months bank statement, salary slips.",
            "Book a follow-up with the loan officer and note it in the interaction summary.",
        ],
    },
    "kyc_update": {
        "title": "KYC update / re-KYC",
        "steps": [
            "Verify identity with the registered mobile OTP.",
            "Collect updated Aadhaar / PAN / address proof as applicable.",
            "Confirm name spelling matches Aadhaar exactly (spaces and initials).",
            "Submit re-KYC; account restrictions lift within 24 hours.",
        ],
    },
    "card_block": {
        "title": "Lost / stolen card",
        "steps": [
            "Block the card immediately via core banking - before anything else.",
            "Confirm the last few transactions with the customer and flag unknown ones.",
            "Explain RBI zero-liability: report within 3 working days and the customer bears no loss for unauthorized transactions.",
            "Raise a complaint for any disputed transactions and share the reference number.",
            "Order a replacement card; delivery in 5-7 working days.",
        ],
    },
    "unauthorized_txn": {
        "title": "Unauthorized transaction report",
        "steps": [
            "Note the transaction date, amount, channel (UPI / card / net banking).",
            "Block the affected instrument and reset credentials.",
            "Explain zero-liability protection and the 10-working-day shadow reversal timeline.",
            "Log a critical complaint with the transaction details.",
            "Give the customer the complaint ID and the ombudsman escalation path if unresolved in 30 days.",
        ],
    },
}


def _groq(messages: list, max_tokens: int = 500) -> Optional[str]:
    if not GROQ_API_KEY:
        return None
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={"model": "llama-3.3-70b-versatile", "messages": messages, "max_tokens": max_tokens, "temperature": 0.2},
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return None


def _glossary_text() -> str:
    return "\n".join(f"- {en} -> {hi}" for en, hi in GLOSSARY.items())


def translate(text: str, source_lang: str, target_lang: str, speaker: str = "customer") -> dict:
    src, tgt = LANGUAGES.get(source_lang, source_lang), LANGUAGES.get(target_lang, target_lang)
    if source_lang == target_lang:
        return {"translation": text, "source": "same-language", "sourceLang": source_lang, "targetLang": target_lang}

    system = (
        f"You are a banking interpreter at an Indian bank branch. Translate the {speaker}'s words from {src} to {tgt}. "
        "Rules: translate faithfully and naturally; keep product names, account numbers, amounts and reference IDs unchanged; "
        "use standard banking terminology in the target language; if the target is Hindi, prefer these glossary terms:\n"
        f"{_glossary_text()}\n"
        "Return ONLY the translated text, nothing else."
    )
    out = _groq([{"role": "system", "content": system}, {"role": "user", "content": text}], max_tokens=400)
    if out:
        return {"translation": out, "source": "groq", "sourceLang": source_lang, "targetLang": target_lang}
    return {
        "translation": text,
        "source": "fallback-no-groq-key",
        "note": "Translation unavailable without GROQ_API_KEY - showing original text.",
        "sourceLang": source_lang, "targetLang": target_lang,
    }


@lru_cache(maxsize=64)
def guide(guide_id: str, lang: str) -> dict:
    g = PROCESS_GUIDES[guide_id]
    if lang.startswith("en"):
        return {"id": guide_id, "title": g["title"], "steps": g["steps"], "lang": lang, "source": "authored"}
    system = (
        f"Translate this bank branch process guide into {LANGUAGES.get(lang, lang)} for a customer to read. "
        "Keep numbering, keep product names and acronyms (KYC, PAN, UPI, EMI) as-is, use the glossary for Hindi:\n"
        f"{_glossary_text()}\nReturn the title on the first line, then one step per line, no extra commentary."
    )
    text = "\n".join([g["title"], *[f"{i + 1}. {s}" for i, s in enumerate(g["steps"])]])
    out = _groq([{"role": "system", "content": system}, {"role": "user", "content": text}], max_tokens=700)
    if out:
        lines = [l.strip() for l in out.splitlines() if l.strip()]
        title, steps = (lines[0], lines[1:]) if lines else (g["title"], g["steps"])
        steps = [s.split(". ", 1)[1] if s[:2].rstrip(".").isdigit() and ". " in s else s for s in steps]
        return {"id": guide_id, "title": title, "steps": steps, "lang": lang, "source": "groq"}
    return {"id": guide_id, "title": g["title"], "steps": g["steps"], "lang": lang, "source": "fallback-no-groq-key"}


def summarize(turns: list[dict], customer_lang: str, staff_lang: str = "en-IN") -> dict:
    transcript = "\n".join(f"[{t.get('speaker', '?')}] {t.get('original', '')}" for t in turns)
    system = (
        "You are documenting a bank branch interaction for the record. Produce a concise bilingual summary: "
        f"first in {LANGUAGES.get(staff_lang, staff_lang)}, then the same summary in {LANGUAGES.get(customer_lang, customer_lang)}. "
        "Include: the customer's request, what was explained or done, any commitments (with timelines), and next steps. "
        "Use the format:\n=== STAFF ===\n<summary>\n=== CUSTOMER ===\n<summary>"
    )
    out = _groq([{"role": "system", "content": system}, {"role": "user", "content": transcript}], max_tokens=600)
    if out and "=== CUSTOMER ===" in out:
        staff_part, cust_part = out.split("=== CUSTOMER ===", 1)
        return {
            "staffSummary": staff_part.replace("=== STAFF ===", "").strip(),
            "customerSummary": cust_part.strip(),
            "source": "groq",
        }
    bullets = "\n".join(f"- {t.get('speaker', '?')}: {t.get('original', '')}" for t in turns)
    return {
        "staffSummary": f"Interaction transcript ({len(turns)} turns):\n{bullets}",
        "customerSummary": "(Bilingual summary requires GROQ_API_KEY.)",
        "source": "fallback-no-groq-key",
    }
