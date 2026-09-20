# ps_banks — Bank Customer Intelligence & Retention Console

A merged banking platform combining two hackathon/IPD projects into one:

- **Aurus-IPD** (banking-themed churn dashboard, complaint inbox, RBI policy
  assistant) — contributed the domain framing and UI concept, but had no
  real backend (client-side CSV parsing, API keys shipped to the browser).
- **Outliers-SPIT-ReDact / ChainForecast** (CRM/sales forecasting platform
  with FastAPI, RFM segmentation, blockchain audit trail) — contributed the
  real backend architecture, but was generic e-commerce/CRM, not banking.

This repo keeps Outliers' FastAPI backend as the single source of truth and
Outliers' React shell as the frontend, with all of Aurus's banking features
(churn risk, complaints, RBI policy assistant) rebuilt on top of it as real
endpoints instead of client-side mocks — and fixes the security issues found
in both originals along the way (hardcoded API keys, unsigned fake "JWT",
open CORS, private keys in query strings).

## What changed from the originals

| Area | Before | Now |
|---|---|---|
| Churn risk | Hand-rolled `if` scoring in the browser (Aurus) | Real `RandomForestClassifier` trained on the same dataset, served via API |
| Segmentation | Generic e-commerce RFM on retail transactions (Outliers) | RFM adapted to banking signals (balance, activity, product depth) |
| Trend Analysis | 90 days of fabricated random-walk data (Outliers) | Real product-adoption trend from tenure cohorts |
| Competitive Index | Generic retail/stock index (Outliers) | Banking market-sentiment index (bank stocks, banking search terms) |
| Complaints | CFPB data faked as Indian names, fetched from the browser (Aurus) | Same relabeling approach, fetched server-side |
| Policy Assistant | RBI PDFs parsed in-browser with a client-side Groq key (Aurus) | Parsed server-side, Groq key never leaves the backend |
| Blockchain | Forecast-only contract, private key in a GET query string (Outliers) | Generic audit-trail contract, signer config is server-side only |
| Auth | No backend at all / unsigned base64 "token" | Real signed JWT (PyJWT), verified server-side on every request |

See [`backend/LIMITATIONS.md`](backend/LIMITATIONS.md) for a full
real/derived/placeholder data-provenance breakdown — nothing here silently
pretends synthetic or fallback data is live.

## Structure

```
ps_banks/
  backend/    FastAPI app (see backend/app/), real trained churn model,
              RFM segmentation, forecast, product trends, market sentiment,
              complaints, policy+CRM assistant, demo blockchain audit trail
  frontend/   React + Vite + Tailwind console, Chart.js visualizations
```

## Running locally

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate      # or source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env        # fill in GROQ_API_KEY etc. to enable full AI features
uvicorn app.main:app --reload --port 8000
```

Demo logins: `agent` / `agent123` (agent role), `admin` / `admin123` (admin role).

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173.

### Demo blockchain (optional)

```bash
npm install -g ganache
ganache
# in another terminal:
cd backend
pip install py-solc-x
export GANACHE_PRIVATE_KEY="0x..."   # a Ganache dev account's private key
python blockchain/deploy.py
# copy the printed AUDIT_CONTRACT_ADDRESS / AUDIT_CONTRACT_ABI_PATH into backend/.env
```

Without Ganache configured, the audit-trail endpoints respond with
`status: "not_configured"` rather than pretending to write to chain.

## Security notes

- JWT is signed server-side (`JWT_SECRET` in `backend/.env`) and verified
  on every request — never trust a client-supplied role.
- `GROQ_API_KEY` / `GEMINI_API_KEY` are read only by the backend process;
  the frontend never sees them.
- CORS is restricted to `CORS_ORIGINS` in `backend/.env` (defaults to the
  local dev frontend only).
- Blockchain RPC URL / private key / contract address are backend
  configuration only — never accepted as request parameters.
