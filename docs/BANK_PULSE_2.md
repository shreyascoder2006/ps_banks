# Bank Pulse 2.0 — retention workflow, design system and honest limits

This document records what was added on top of the existing console, how it works,
what it deliberately does not claim, and how to run and verify it.

## The chain this build makes demonstrable

signal → behavioural feature → model score → persistent alert (with evidence) → ranked, explained
options → human approval → (simulated) delivery → outcome with provenance → dashboard and
experiment report that count only what the evidence supports.

Open **Scenario Studio**, create a run, press Play. Then open **Early Warning**, the alert,
draft → approve → record delivery → record outcome, and look at **Overview** and
**Outreach → Experiment report**. **Reset scenario** removes only that run's records.

## Backend

New package `backend/app/services/retention/`:

| Module | Purpose |
|---|---|
| `features.py` | Pure, deterministic rolling-window (7/30/90d) feature aggregation, own-baseline and peer deviation. Unknown values are `None`, never zero-filled. `sufficiency` = ok / sparse / cold_start. |
| `event_store.py` | Idempotent event ingestion (`idempotency_key`), late/suspect quality flags, DB audit log helper. |
| `alerts.py` | Persistent alerts, named triggers, thresholds (`ALERT_*` env, bounds-clamped, admin-editable), dedupe, cooldown, status workflow with required reasons, history. |
| `actions.py` | Ranked channel options, consent / cooldown / frequency-cap / duplicate checks, recommended → approved → delivered(simulated) lifecycle, feature snapshot at recommendation time, outcome recording with provenance. |
| `experiments.py` | Treatment vs holdout report: dedupe per (customer, campaign), Wilson and Newcombe intervals, explicit missing/pending handling. |
| `model_health.py` | Metrics, confusion matrix, calibration status, PSI drift, data-quality checks. |
| `scenarios.py` | Deterministic seeded "quiet decline" journey; isolated reset. |
| `dashboard.py` | Read models for Overview and the unified customer timeline. |

New tables (created automatically; `db._add_missing_columns` adds new columns to existing
SQLite files, `_backfill_legacy_provenance` labels old rows): `customerevent`, `alert`,
`alerthistory`, `contactpreference`, `auditlog`, `risksnapshot`, `booksnapshot`, `scenariorun`;
new columns on `outreachaction` (status, simulated, approved_by/at, campaign, experiment_group,
observation_days, feature_snapshot) and `outreachoutcome` (source, observed, recorded_by).

### Endpoints added (all require a bearer token)

`POST /events` (admin) · `GET /events/types` · `GET /customers/{id}/features|timeline|risk-history` ·
`PUT /customers/{id}/contact-preferences` · `GET /alerts`, `/alerts/summary`, `/alerts/config`,
`/alerts/{id}` · `PUT /alerts/config` (admin) · `POST /alerts/evaluate/{customer}`,
`/alerts/{id}/status|assign|notes` · `GET /workbench/options/{customer}`, `/workbench/actions` ·
`POST /workbench/recommend`, `/workbench/actions/{id}/approve|dismiss|execute|outcome` ·
`GET /dashboard/overview`, `/experiments/report`, `/model/health`, `/audit/log` ·
`GET /scenarios`, `POST /scenarios/runs`, `GET /scenarios/runs/{id}`, `POST /scenarios/runs/{id}/step`,
`DELETE /scenarios/runs/{id}`.

Modified (backward compatible): `POST /outreach/trigger` now applies the same safeguards (409 when
blocked); `POST /outreach/{id}/outcome` records provenance; `POST /outreach/retrain` (admin)
writes an audit entry with before/after metrics; `/outreach/effectiveness` excludes simulated outcomes.

### ML and data-provenance decisions

* The Random Forest is unchanged in behaviour. Saved metrics now include PR-AUC, precision, recall,
  F1, Brier, confusion matrix, calibration bins, model/data version and a PSI reference. An artifact
  without the v2 metrics schema is retrained once on load.
* **Scores are not calibrated probabilities** (`class_weight=balanced`); the UI says so.
* Evaluation is a stratified random hold-out. A temporal split is **not possible**: the dataset has no timestamps.
* **Event → score pathway:** the model only consumes `Is Active Member` and `Balance` from events,
  via the existing `CustomerSignal` overlay (inactivity ≥ 30 days ⇒ inactive; latest balance). All
  other model inputs remain the dataset record. The pathway is stored in each alert's evidence.
* Observed model quirk: in this dataset higher balances correlate with churn, so a scenario balance
  *drop* alone can lower the score while inactivity raises it. The scenario page explains this.
* The old simulator generated random "retained/churned" outcomes and let them overwrite training
  labels. They are now stored `observed=false`, excluded from training, effectiveness and experiments;
  legacy rows are back-filled.
* `complaint_count` / `outreach_count` remain operational model features; they can change after an
  intervention, so scores of already-contacted customers are not strictly pre-intervention.

### Alert rules

An alert needs a named trigger: risk band crossing, rise ≥ 10 points, inactivity ≥ 30 days,
balance fall ≥ 40 % in 30 days, or ≥ 2 complaints / unresolved. The first evaluation of a customer only
stores a baseline (no alert). One active alert per customer; later evidence is appended and severity
can escalate. A 24 h cooldown applies after closure. Resolving or dismissing needs a reason.

## Frontend

* Design tokens and accessibility in `index.css` (CSS variables, focus-visible ring, reduced-motion,
  selected-row style). Shared primitives in `components/ui.jsx` (formatters, `Kpi`, `Section`,
  `Provenance`, `SeverityBadge`, `Boundary` loading/error/empty states) and `lib/useApi.js`.
* Shell: grouped navigation with live open-alert badge, mobile drawer, skip link, breadcrumbs, global
  customer search, smaller assistant button; the "Play story" button no longer overlaps the sidebar.
* New: **Early Warning** (`/alerts`), **Scenario Studio** (`/scenarios`), `ActionWorkbench`,
  `CustomerTimeline`, `RiskTrajectory` (SVG, true time axis, annotations), `ModelHealth`.
* Rebuilt **Overview** on `/dashboard/overview`; **Outreach** gained Workbench and Experiment report
  tabs; **Churn Pulse** gained model health; **Customer 360** gained next-best-action and timeline.
* Runtime dependencies: none added in the first pass (pytest + httpx are dev-only). The second pass added
  `three` and `@react-three/fiber`, used only by the lazily loaded Signal Network chunk.

## UI redesign pass (second iteration)

* **Tokens and motion** (`index.css`): spacing, radius, shadow, duration and disabled-opacity tokens beside
  the colour tokens. One entrance motion (`.page-enter`, `.reveal` with a per-block `--i` stagger), bar growth
  and line draw-in. All of it is switched off by `prefers-reduced-motion`. Fill mode is `backwards` on purpose:
  a lingering transform would trap `position: fixed` children such as the mobile bottom sheet.
* **Shared parts** (`components/ui.jsx`): `Tabs` (arrow keys, roving tabindex), `RiskMeter`, `DistributionBar`,
  `BarList`, a single `SEVERITY` scale, plus the earlier `Kpi`, `Section`, `Boundary` and `Provenance`.
* **Churn Pulse** is now a model-intelligence workspace: book-wide risk distribution (clickable bands), critical
  customers by branch, a *Global model behaviour* panel (ROC-AUC, PR-AUC, precision, recall, F1, Brier each with
  context, then tabs for feature importance, confusion matrix, calibration, drift and data quality, limitations), a
  sortable and filterable ranking, and a per-customer evidence panel (score, rule-based suggestion, drivers,
  what-would-move-the-score, stored score history). Global and per-customer views are labelled as separate things.
  The ranking panel is a sticky side panel on large screens and a bottom sheet on small ones.
* **Customer 360** was reorganised around the current situation and the next action: score and key facts, why the
  score is what it is, behavioural indicators, then tabs (Timeline, Complaints, Outreach history). A right rail
  holds the offer preview, ranked channel options with the approval flow, the what-if simulator and the legacy quick
  trigger. Behavioural indicators come from `/customers/{id}/features`; for customers with no event history it says
  so and shows the dataset's profile fields, with the proxy value labelled.
* **Retention Signal Network** (Churn Pulse, opened on demand): up to 250 highest-scoring critical and 250
  highest-scoring high customers, grouped around branch hubs. Distance from the hub core is the model score, height
  and size are balance, colour is severity, a ring marks an open alert. Hover shows the customer or branch totals;
  selecting a node opens the same evidence panel as the table. Built with `three` and `@react-three/fiber`, loaded as
  a separate lazy chunk (about 226 kB gzipped; the main bundle grew by about 12 kB), rendered on demand with no
  animation loop, pixel ratio capped at 1.5. A 2D top-down map of the same layout is the fallback when WebGL is
  missing, the scene fails, or 2D is chosen. It shows the top of each band only, not the whole book (the UI says so).
* **Responsive fixes on the older pages:** fixed multi-column grids on Segments, Market Sentiment, Complaints
  and Complaint Insights caused page-level horizontal scroll at 375 px; they now stack. Every route was measured at
  375, 768 and desktop widths for horizontal overflow.
* **Backend:** `action_to_dict` now also returns `status`, `simulated` and `outcomeObserved` so outreach history can
  show provenance. No endpoint was removed or renamed.

## Not done, and why

* **Frontend automated tests:** none. There is no runner in `frontend/`; layout was checked by measuring every
  route in a browser at three widths, and behaviour by driving the pages by hand.
* **3D scene accessibility:** a WebGL canvas cannot be keyboard-driven. The ranking table lists the same customers
  and is the accessible route; the 2D map's nodes are not individually tabbable (only those with an open alert are).
* **Visual polish not covered:** Complaints (board and inbox), Frontline Assist, Policy Assistant, Forecast, Product
  Trends and Market Sentiment keep their original layouts; they get the shared tokens, shell and responsive fixes but
  were not redesigned screen by screen. No colour-contrast audit tool was run.
* **Browser-pane caveat:** the in-app browser used for verification did not size or paint WebGL canvases until
  the page was drawn, so first-frame timing of the 3D view was checked there but not on a real GPU browser.
* **Real delivery, consent and campaign-cost data:** no integrations exist. Delivery is always
  simulated; consent defaults to "unknown, treated as permitted" and says so; no uplift is estimated.
* Complaint creation does not yet write `CustomerEvent` rows; complaints appear on the timeline from
  their own table, and the complaint-spike trigger uses scenario/ingested events.
* Overview risk trend is built from stored snapshots (one per ≥ 10 min of dashboard use), so it starts
  short and grows. This is real data, not a placeholder.

## Production gaps (demo-grade)

Two in-memory demo users; JWT secret in `.env`; SQLite; no rate limiting; alert thresholds held in
process memory after an admin edit (env defaults on restart); approvals by any signed-in staff role
(admin-only privileged operations: event ingestion, alert configuration, retraining).

## Verify

```bash
cd backend && .venv/Scripts/python -m pytest tests -q      # 29 tests
cd frontend && npm run build
```
