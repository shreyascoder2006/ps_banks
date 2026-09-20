# Limitations & data provenance

This backend merges two hackathon/IPD projects (Aurus-IPD and
Outliers-SPIT-ReDact) into one banking platform. In the spirit of not
silently fabricating data, this file tags every non-obvious signal as
**real**, **derived/proxy**, or **placeholder**.

## Real (taken directly from source data / live computation)
- `CreditScore`, `Geography`, `Gender`, `Age`, `Tenure`, `Balance`,
  `Num Of Products`, `Has Credit Card`, `Is Active Member`,
  `Estimated Salary`, `Churn` — all straight from `data/churn_data.csv`
  (the public Kaggle bank-churn dataset, same file the original Aurus
  frontend used).
- Churn risk score/level — a real `RandomForestClassifier` trained on the
  `Churn` label in that dataset (see `app/services/churn.py`), evaluated
  on a real held-out test split (AUC/accuracy reported by `/customers/model/metrics`).
- RFM segment quantiles, offer economics, loyalty-token formula — ported
  as-is from the original Outliers `crm/rfm.py` / `crm/offers.py`.
- Product-uptake trend — computed from real product-holding data
  (tenure-cohort comparison), not synthetic.
- Complaint narratives — real CFPB (US) public consumer-complaint text,
  fetched live from the CFPB API.
- Blockchain audit trail — a genuine Solidity contract (`blockchain/AuditTrail.sol`)
  deployable to a local Ganache instance via Web3.py; SHA-256 hashing is real.

- Outreach channel selection — transparent rules over real fields
  (segment, balance, activity flag, risk level, open complaints); every
  recommendation returns the reasons it fired.
- Outcome feedback loop — recorded outreach outcomes (`retained` /
  `churned`) override the historical `Churn` label for that customer and
  are up-weighted (x3) on retrain; `complaint_count` and `outreach_count`
  from the operational DB are model features. The loop is real and
  mechanically complete, but with demo-scale outcome volume it will only
  move individual customers' scores, not the headline AUC — the API
  reports `feedback_rows_used` honestly.

## Derived / proxy (deterministic stand-ins for data the dataset lacks)
- `last_active_days_proxy`, `monthly_txn_count_proxy` — the churn dataset
  has no transaction timestamps, so "recency" and "frequency" for RFM are
  deterministically derived from `Is Active Member` / `Num Of Products` via
  a stable hash of `CustomerId` (same customer always gets the same proxy
  value; not re-randomized per request, unlike the original Aurus frontend
  which used `Math.random()` on every load).
- `joined_year` / customer-growth forecast — derived from `Tenure` (a
  coarse, yearly figure), fit with a simple linear trend. This is
  explicitly **not** the Prophet/ARIMA/XGBoost stack from the original
  Outliers project, because that required daily transaction data this
  dataset doesn't have. Labelled "illustrative" in the API response.
- Complaint customer names/account numbers — real CFPB complaint *text*,
  relabelled with generic Indian names/account numbers for the demo
  (same substitution approach the original Aurus frontend used).

## Placeholder / fallback (used only when a live signal is unavailable)
- Market Sentiment Index components (`app/services/market_sentiment.py`)
  each carry a `source: "live"` or `source: "fallback"` tag. Fallback
  values are used when `pytrends`/`yfinance`/`vaderSentiment` aren't
  installed, rate-limit, or fail — the frontend must never present a
  fallback number as if it were live.
- News-sentiment leg uses a fixed set of canned banking headlines (no news
  API key configured) — clearly not real-time news.
- AI complaint analysis / draft response / policy assistant answers
  degrade to a rule-based fallback (tagged `source: "fallback-no-groq-key"`)
  when `GROQ_API_KEY` isn't set in `backend/.env`.
- The demo blockchain audit endpoints return `status: "not_configured"`
  rather than pretending to write to chain when Ganache/the contract
  aren't set up — see `backend/blockchain/deploy.py`. When configured
  (`GANACHE_PRIVATE_KEY`/`AUDIT_CONTRACT_ADDRESS` set), writes are real
  on-chain transactions against a local Ganache instance; a reverted
  transaction (e.g. insufficient gas) is reported as `status: "failed"`
  with the tx hash, never silently reported as `"stored"`.

## Known simplifications vs. the two original projects
- No Prophet/ARIMA/XGBoost model selection (see above).
- No voice/speech features from the original Aurus Assist module.
- No heatmap or "competitive index" stock-ticker sector breakdown beyond
  the sentiment index above.
- Demo auth uses two in-memory accounts (`agent`/`admin`), not a real user
  database — fine for a demo, not for production.
