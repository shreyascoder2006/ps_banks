"""Retrieval layer for the project chatbot.

Everything the bot may be asked about is chunked and indexed with TF-IDF:
  - curated overview of every page / concept (CURATED below)
  - README + LIMITATIONS (data provenance)
  - the RBI policy PDFs
  - the backend + frontend source code (so rule questions like "how is the
    outreach channel chosen" are answered from the actual implementation)
  - the live API surface, generated from the FastAPI OpenAPI schema
The index is built lazily once per process.
"""
import re
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pypdf import PdfReader
from sklearn.feature_extraction.text import TfidfVectorizer

from ...config import BASE_DIR, DOCS_DIR

PROJECT_ROOT = BASE_DIR.parent
CHUNK_CHARS = 1100
OVERLAP = 150

CURATED = [
    ("Bank Pulse overview", """Bank Pulse is a Bank Customer Intelligence & Retention Console for Indian bank branch staff. It merges two earlier projects (Aurus-IPD churn dashboard and Outliers ChainForecast CRM). Backend: FastAPI + SQLModel/SQLite + scikit-learn. Frontend: React + Vite + Tailwind + Chart.js. It addresses problem statements PS4 (Predictive Customer Outreach for Connection and Retention), PS5 (Unified Customer Complaint Dashboard), PS6 (multilingual frontline assist) and an optional blockchain audit trail. Demo logins: agent/agent123 (agent role, Mumbai Main branch) and admin/admin123 (admin role, Head Office). Only admins can retrain the model and write blockchain audit records."""),
    ("Pages and navigation", """Sidebar pages: Overview (/) book-wide KPIs, risk distribution, watchlist, branch map, activity feed. Churn Pulse (/pulse) scored customer table with filters by risk level, branch, segment, search, sort. Customer 360 (/customers/:id) full profile, churn drivers, explainability bars, what-if simulator, RFM segment and offer, complaints and outreach history. Outreach (/outreach) recommended channel and personalised message, trigger outreach, record outcomes, effectiveness stats. Segments & Offers (/segments) RFM segments, personalised offers, loyalty tokens, campaign impact what-if. Growth Forecast (/forecast) customer growth projection from tenure cohorts. Product Trends (/trends) product adoption of new vs established customers by geography. Market Sentiment (/sentiment) banking market sentiment index 0-100. Resolve (/complaints) complaint inbox with AI analysis, draft response, SLA, status workflow and escalation. Complaint insights (/complaints/insights) trends, root causes, related complaints, regulatory export. Policy Assistant (/assistant) RBI policy Q&A. Frontline Assist (/frontline) multilingual translation, speech, process guides, bilingual summary. Audit Trail (/blockchain) blockchain audit records and blocks. Story Mode is a guided demo tour. A live demo simulator can generate activity (off by default)."""),
    ("Churn model", """Churn risk comes from a RandomForestClassifier trained on the Churn label of the public Kaggle bank-churn dataset (10,000 customers, 20.4% churned historically). Features: CreditScore, Age, Tenure, Balance, Num Of Products, Has Credit Card, Is Active Member, Estimated Salary, Geography, Gender, plus operational complaint_count and outreach_count. Output is a probability shown as a 0-100 score. Risk levels: critical >= 70, high >= 50, medium >= 30, low < 30. Recommended action: critical = immediate retention call; high = proactive outreach within 48h; otherwise cross-sell or routine check-in. Drivers shown per customer are rule-based reasons tied to the model's top feature importances (inactive member, single product, low balance, low credit score, short tenure, complaints). Explainability bars are single-feature perturbation through the model, not SHAP. The what-if simulator re-scores a customer with hypothetical values. Recorded outreach outcomes (retained/churned) override the historical label and are up-weighted x3 when an admin retrains."""),
    ("Segments and offers", """RFM segmentation adapted for banking: Recency from last_active_days_proxy (proxy), Frequency from monthly transaction count proxy blended with Num Of Products, Monetary from Balance (real). Quantile scores 1-5 give segments: Champions (R,F,M >= 4), Loyal Customers (all >= 3), Potential Loyalists (R >= 4, F >= 2), At-Risk (R <= 2, F >= 3), Hibernating (R <= 2, F <= 2), New Customers (R >= 4, F = 1), Others. Offers: Champions get Wealth Desk Priority Review; Loyal get Preferred Rate Fixed Deposit; Potential Loyalists get Fee Waiver + Cross-sell; At-Risk get Retention Call + Rate Match; Hibernating get Reactivation Package; New get Welcome Bundle. Separately, the customer 'segment' field in the customer table is an income tier by estimated salary: retail (<80k), mass_affluent (80k-150k), hni (>150k). Seven branches: Mumbai Main, Delhi Connaught, Bangalore MG Road, Chennai Anna Nagar, Pune FC Road, Hyderabad Banjara Hills, Kolkata Park Street."""),
    ("Outreach rules", """Outreach channel selection is rule-based and each recommendation lists its reasons. In order: unresolved complaint -> phone call; hni segment or balance >= 1,000,000 -> relationship manager visit; critical risk and inactive -> call; active member with critical/high risk -> in-app notification; medium risk -> email; low risk -> SMS. Channels: rm_visit, call, email, sms, in_app. Outcomes recorded: retained, churned, no_response. Triggering outreach writes an audit hash to the blockchain when configured. The message is personalised by the LLM with a template fallback."""),
    ("Complaints", """Complaints come from real CFPB narratives relabelled with Indian names and linked to high-risk customers. Fields: category, severity, channel, status (open, in_progress, escalated, resolved), assignee, SLA. SLA hours by severity: critical 4h, high 24h, medium 72h, low 168h. Severity examples: fraud and unauthorized transactions are critical; account closing and lender charging issues high. AI analysis returns summary, sentiment, key issues, regulatory risk and recommended action; the AI can draft a response for agent review. Related/duplicate complaints are found with TF-IDF similarity. A regulatory export (JSON/CSV) is available. RBI guidance: 30-day resolution mandate for complaints and zero-liability for unauthorized transactions reported promptly."""),
    ("Data provenance", """Real: the churn dataset fields, model scores, complaint text. Proxy (deterministic from CustomerId hash because the dataset has no transaction dates): last_active_days_proxy and monthly_txn_count_proxy. Forecast is a simple linear trend over tenure cohorts, labelled illustrative. Market sentiment shows live or fallback per component. The blockchain returns not_configured unless Ganache and the contract are set up. See LIMITATIONS for the full list."""),
    ("Chatbot", """The Bank Pulse chatbot runs locally on Ollama (default model llama3.1:8b). It retrieves context from this knowledge base (docs, RBI PDFs, source code, API list) and can call read-only tools for live data: customers, churn, segments, complaints, outreach, forecast, trends, sentiment, audit trail and custom aggregate queries. It never sends data to a cloud model."""),
]


@dataclass
class Chunk:
    source: str
    text: str


def _split(text: str) -> list[str]:
    text = re.sub(r"[ \t]+\n", "\n", text)
    out, i = [], 0
    while i < len(text):
        end = min(i + CHUNK_CHARS, len(text))
        if end < len(text):
            cut = text.rfind("\n", i + CHUNK_CHARS // 2, end)
            end = cut if cut != -1 else end
        piece = text[i:end].strip()
        if piece:
            out.append(piece)
        if end >= len(text):
            break
        i = max(end - OVERLAP, i + 1)
    return out


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _api_chunks() -> list[Chunk]:
    try:
        from ...main import app
        lines = []
        for path, ops in app.openapi().get("paths", {}).items():
            for method, op in ops.items():
                lines.append(f"{method.upper()} {path} - {op.get('summary', '')}")
        return [Chunk("API endpoints", t) for t in _split("Backend API endpoints:\n" + "\n".join(lines))]
    except Exception:
        return []


def _build_chunks() -> list[Chunk]:
    chunks = [Chunk(f"Overview: {title}", body) for title, body in CURATED]

    for name in ("README.md", "backend/LIMITATIONS.md"):
        for piece in _split(_read(PROJECT_ROOT / name)):
            chunks.append(Chunk(name, piece))

    for fname, label in (
        ("rbi_customer_service.pdf", "RBI Master Circular on Customer Service"),
        ("rbi_grievance_redressal.pdf", "RBI Grievance Redressal Guidelines"),
    ):
        path = DOCS_DIR / fname
        if path.exists():
            try:
                text = "\n".join(p.extract_text() or "" for p in PdfReader(str(path)).pages)
            except Exception:
                continue
            for piece in _split(text):
                chunks.append(Chunk(label, piece))

    code_roots = [(BASE_DIR / "app", "*.py"), (PROJECT_ROOT / "frontend" / "src", "*.jsx"),
                  (BASE_DIR / "blockchain", "*.sol")]
    for root, pattern in code_roots:
        for path in sorted(root.rglob(pattern)):
            if "chatbot" in path.parts or "__pycache__" in path.parts:
                continue
            rel = path.relative_to(PROJECT_ROOT).as_posix()
            for piece in _split(_read(path)):
                chunks.append(Chunk(rel, piece))

    chunks.extend(_api_chunks())
    return chunks


class _Index:
    def __init__(self):
        self.chunks = _build_chunks()
        self.vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True,
                                   token_pattern=r"(?u)\b[A-Za-z_][A-Za-z0-9_]+\b", max_features=60000)
        self.matrix = self.vec.fit_transform([f"{c.source}\n{c.text}" for c in self.chunks])
        # prose (curated notes, docs, RBI PDFs) answers questions better than raw code
        self.boost = np.array([1.0 if c.source.endswith((".py", ".jsx", ".sol")) else 1.6 for c in self.chunks])


_index = None
_lock = threading.Lock()


def get_index() -> _Index:
    global _index
    with _lock:
        if _index is None:
            _index = _Index()
        return _index


def retrieve(query: str, k: int = 4, min_score: float = 0.06) -> list[Chunk]:
    idx = get_index()
    scores = (idx.matrix @ idx.vec.transform([query]).T).toarray().ravel()
    scores = scores * idx.boost
    order = np.argsort(-scores)
    picked, per_source = [], {}
    for i in order:
        if scores[i] < min_score or len(picked) >= k:
            break
        c = idx.chunks[i]
        if per_source.get(c.source, 0) >= 2:
            continue
        per_source[c.source] = per_source.get(c.source, 0) + 1
        picked.append(c)
    return picked
