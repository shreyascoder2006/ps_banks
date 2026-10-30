import { LineChart } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useApi } from '../lib/useApi';
import {
  Boundary, EmptyState, fmt, Provenance, SEVERITY,
} from './ui';

const W = 560;
const H = 190;
const PAD = { l: 38, r: 14, t: 12, b: 28 };
const BANDS = [40, 60, 80];

function Chart({ points }) {
  const [hover, setHover] = useState(null);
  const m = useMemo(() => {
    const t = points.map((p) => new Date(p.at).getTime());
    const tMin = Math.min(...t);
    const tMax = Math.max(Math.max(...t), tMin + 60_000);
    const x = (ms) => PAD.l + ((ms - tMin) / (tMax - tMin)) * (W - PAD.l - PAD.r);
    const y = (v) => H - PAD.b - (v / 100) * (H - PAD.t - PAD.b);
    return { t, tMin, tMax, x, y };
  }, [points]);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${m.x(m.t[i]).toFixed(1)},${m.y(p.score).toFixed(1)}`).join(' ');
  const span = m.tMax - m.tMin;
  const fx = (ms) => new Date(ms).toLocaleString('en-IN', span > 86_400_000 * 2 ? { day: '2-digit', month: 'short' } : { hour: '2-digit', minute: '2-digit' });
  const last = points[points.length - 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`Risk score history for this customer: ${points.length} readings, latest ${last.score.toFixed(0)} (${last.level})`}>
        {[0, ...BANDS, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={m.y(v)} y2={m.y(v)} stroke="rgba(255,255,255,0.07)" strokeDasharray={BANDS.includes(v) ? '3 4' : '0'} />
            <text x={PAD.l - 6} y={m.y(v) + 3} textAnchor="end" fontSize="10" fill="#8b93a7">{v}</text>
          </g>
        ))}
        <text x={10} y={H / 2} fontSize="10" fill="#8b93a7" transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle">Risk score (0–100)</text>
        {[0, 1 / 3, 2 / 3, 1].map((f) => <text key={f} x={m.x(m.tMin + span * f)} y={H - 8} textAnchor="middle" fontSize="10" fill="#8b93a7">{fx(m.tMin + span * f)}</text>)}
        {points.length > 1 && <path d={line} fill="none" stroke="#d4af37" strokeWidth="2" strokeLinejoin="round" style={{ '--len': 2000 }} className="draw-line" />}
        {points.map((p, i) => (
          <circle key={p.at} cx={m.x(m.t[i])} cy={m.y(p.score)} r={hover === i ? 6 : 4}
            fill={p.source === 'simulator' ? '#0a1428' : SEVERITY[p.level]?.color || '#d4af37'}
            stroke={SEVERITY[p.level]?.color || '#d4af37'} strokeWidth="2" tabIndex={0}
            aria-label={`${fmt.date(p.at)}: score ${p.score.toFixed(0)}, ${p.level}${p.source === 'simulator' ? ', simulated' : ''}`}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
        ))}
      </svg>
      {hover != null && (
        <div className="absolute top-1 right-2 card px-3 py-2 text-xs pointer-events-none">
          <div className="text-gray-400">{fmt.date(points[hover].at)}</div>
          <div className="text-white font-semibold tabular-nums">Score {points[hover].score.toFixed(0)} · {points[hover].level}</div>
          {points[hover].source === 'simulator' && <div className="text-risk-high">Simulated reading</div>}
        </div>
      )}
      <p className="text-[11px] text-gray-500 mt-1">Hollow marker = simulated reading. Dashed lines mark the 40 / 60 / 80 severity thresholds.</p>
    </div>
  );
}

/** A single customer's stored risk-score history (RiskSnapshot rows). Empty until the customer has been evaluated. */
export default function ScoreTrend({ customerId, version = 0 }) {
  const state = useApi(`/customers/${customerId}/risk-history`, { params: { v: version } });
  return (
    <Boundary state={state} rows={4} isEmpty={(d) => d.points.length === 0}
      empty={(
        <EmptyState title="No score history recorded yet" icon={LineChart}>
          A reading is stored each time this customer is evaluated for early-warning alerts. Run a scenario or evaluate the customer and the trajectory builds from real readings. Nothing is back-filled.
        </EmptyState>
      )}>
      {(d) => (
        <div>
          <div className="flex items-center gap-2 mb-2 text-[11px] text-gray-500">
            <Provenance kind="model">Model score</Provenance>
            {d.points.length < 3 && <span>Only {d.points.length} reading{d.points.length === 1 ? '' : 's'} so far — a trend needs more.</span>}
          </div>
          <Chart points={d.points} />
        </div>
      )}
    </Boundary>
  );
}
