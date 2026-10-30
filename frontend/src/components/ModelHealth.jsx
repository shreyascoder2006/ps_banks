import React from 'react';
import { fmt, Provenance } from './ui';

/* Pieces of the global model view (GET /model/health). Pulse composes them into a workspace;
   none of this describes a single customer — that lives in the customer detail panel. */

export function Metric({ label, value, context, tone = 'text-white' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className={`text-2xl font-bold tabular-nums leading-tight mt-0.5 ${tone}`}>{value}</div>
      {context && <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{context}</div>}
    </div>
  );
}

export function ModelProvenance({ h }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <Provenance kind="model">{h.version}</Provenance>
      <span className="badge bg-white/[0.06] text-gray-300">data {h.dataVersion}</span>
      <span className="badge bg-white/[0.06] text-gray-300">trained {fmt.date(h.trainedAt)}</span>
      <span className={`badge border ${h.calibrated ? 'bg-risk-low/10 text-risk-low border-risk-low/25' : 'bg-risk-high/10 text-risk-high border-risk-high/25'}`}
        title={h.calibrationNote}>
        {h.calibrated ? 'calibrated' : 'not calibrated — a ranking, not a probability'}
      </span>
    </div>
  );
}

export function MetricStrip({ h }) {
  const m = h.metrics;
  const positives = h.confusion.tp + h.confusion.fn;
  const base = positives / Math.max(1, positives + h.confusion.tn + h.confusion.fp);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
      <Metric label="ROC-AUC" value={m.auc.toFixed(3)} tone="text-gold" context="Ranking quality on held-out customers. 0.5 is a coin flip." />
      <Metric label="PR-AUC" value={m.pr_auc.toFixed(3)} context={`Precision-recall area. Baseline equals the churn rate, ${fmt.pct(base, 0)}.`} />
      <Metric label="Precision" value={fmt.pct(m.precision, 0)} context={`Of customers flagged at ${m.threshold}, share that churned.`} />
      <Metric label="Recall" value={fmt.pct(m.recall, 0)} context={`Of customers who churned, share flagged at ${m.threshold}.`} />
      <Metric label="F1" value={m.f1.toFixed(2)} context="Balance of precision and recall." />
      <Metric label="Brier" value={m.brier.toFixed(3)} context="Lower is better. Inflated here because scores are uncalibrated." />
    </div>
  );
}

export function ConfusionMatrix({ h }) {
  const c = h.confusion;
  return (
    <div>
      <table className="text-xs w-full text-center border-separate border-spacing-1">
        <caption className="sr-only">Confusion matrix at threshold {h.metrics.threshold}</caption>
        <thead><tr><td /><th scope="col" className="text-gray-500 font-normal">Pred. stay</th><th scope="col" className="text-gray-500 font-normal">Pred. churn</th></tr></thead>
        <tbody>
          <tr><th scope="row" className="text-gray-500 font-normal text-right pr-1">Stayed</th><td className="rounded bg-risk-low/10 py-2.5 tabular-nums" title="True negatives">{fmt.int(c.tn)}</td><td className="rounded bg-risk-high/10 py-2.5 tabular-nums" title="False positives">{fmt.int(c.fp)}</td></tr>
          <tr><th scope="row" className="text-gray-500 font-normal text-right pr-1">Churned</th><td className="rounded bg-risk-critical/10 py-2.5 tabular-nums" title="False negatives">{fmt.int(c.fn)}</td><td className="rounded bg-risk-low/10 py-2.5 tabular-nums" title="True positives">{fmt.int(c.tp)}</td></tr>
        </tbody>
      </table>
      <p className="text-[11px] text-gray-500 mt-2">Threshold {h.metrics.threshold}. Evaluated on {fmt.int(h.testRows)} held-out customers; trained on {fmt.int(h.trainRows)}.</p>
    </div>
  );
}

export function Calibration({ h }) {
  const points = h.calibration;
  const S = 190; const P = 28;
  const x = (v) => P + v * (S - 2 * P);
  const y = (v) => S - P - v * (S - 2 * P);
  return (
    <div>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[220px] h-auto" role="img" aria-label="Calibration: predicted score versus observed churn rate. The dashed diagonal is perfect calibration.">
        <rect x={P} y={P} width={S - 2 * P} height={S - 2 * P} fill="none" stroke="rgba(255,255,255,0.08)" />
        {[0.25, 0.5, 0.75].map((v) => <g key={v}><line x1={x(v)} x2={x(v)} y1={y(0)} y2={y(1)} stroke="rgba(255,255,255,0.04)" /><line x1={x(0)} x2={x(1)} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.04)" /></g>)}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
        <polyline fill="none" stroke="#d4af37" strokeWidth="2" points={points.map((p) => `${x(Math.min(p.predicted, 1))},${y(Math.min(p.observed, 1))}`).join(' ')} />
        {points.map((p) => (
          <circle key={p.predicted} cx={x(Math.min(p.predicted, 1))} cy={y(Math.min(p.observed, 1))} r="3.5" fill="#d4af37" tabIndex={0} aria-label={`predicted ${p.predicted}, observed ${p.observed}`}>
            <title>{`predicted ${p.predicted}, observed ${p.observed}`}</title>
          </circle>
        ))}
        <text x={S / 2} y={S - 6} textAnchor="middle" fontSize="9" fill="#8b93a7">predicted score (0–1)</text>
        <text x={9} y={S / 2} fontSize="9" fill="#8b93a7" transform={`rotate(-90 9 ${S / 2})`} textAnchor="middle">observed churn rate</text>
      </svg>
      <p className="text-[11px] text-gray-500 mt-1">{h.calibrationNote}</p>
    </div>
  );
}

export function DriftList({ h }) {
  const tone = (s) => (s === 'stable' ? 'text-risk-low' : s === 'moderate shift' ? 'text-risk-high' : 'text-risk-critical');
  return (
    <div>
      <ul className="space-y-2">
        {h.drift.map((d) => (
          <li key={d.feature} className="flex justify-between gap-3 text-xs">
            <span className="text-gray-300 truncate">{d.feature}</span>
            <span className={`tabular-nums shrink-0 ${tone(d.status)}`}>{d.psi.toFixed(3)} · {d.status}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-500 mt-2">PSI &lt; 0.1 stable, 0.1–0.25 moderate, &gt; 0.25 significant. Compares live scores, including event overlays, with the training data.</p>
      <dl className="grid grid-cols-2 gap-1 mt-3 text-[11px]">
        <dt className="text-gray-500">Rows</dt><dd className="text-gray-300 tabular-nums">{fmt.int(h.dataQuality.rows)}</dd>
        <dt className="text-gray-500">Null feature cells</dt><dd className="text-gray-300 tabular-nums">{h.dataQuality.nullCells}</dd>
        <dt className="text-gray-500">Duplicate IDs</dt><dd className="text-gray-300 tabular-nums">{h.dataQuality.duplicateCustomerIds}</dd>
        <dt className="text-gray-500">Feedback rows used</dt><dd className="text-gray-300 tabular-nums">{h.feedbackRowsUsed}</dd>
      </dl>
    </div>
  );
}

export function Limitations({ h }) {
  return (
    <div>
      <ul className="list-disc pl-5 space-y-1.5 text-xs text-gray-400">{h.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      <p className="text-[11px] text-gray-600 mt-3">{h.evaluationMethod}</p>
    </div>
  );
}
