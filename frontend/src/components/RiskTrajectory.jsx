import React, { useMemo, useState } from 'react';
import { fmt } from './ui';

const SEV_COLOR = { critical: '#f43f5e', high: '#f59e0b', medium: '#38bdf8' };
const W = 720;
const H = 240;
const PAD = { l: 44, r: 16, t: 14, b: 32 };

/**
 * Time-series of the monitored book's average risk (from persisted BookSnapshot rows) with
 * event annotations (alerts, model retrains, simulated deliveries). Plain SVG so axes,
 * units and keyboard focus are fully controlled. x is true time, not index.
 */
export default function RiskTrajectory({ points, annotations = [], onSelectAnnotation }) {
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    if (!points?.length) return null;
    const t = points.map((p) => new Date(p.at).getTime());
    const tMin = Math.min(...t);
    const tMax = Math.max(Math.max(...t), tMin + 60_000);
    const vals = points.map((p) => p.avgRisk);
    const lo = Math.floor(Math.min(...vals) - 1);
    const hi = Math.ceil(Math.max(...vals) + 1);
    const x = (ms) => PAD.l + ((ms - tMin) / (tMax - tMin)) * (W - PAD.l - PAD.r);
    const y = (v) => H - PAD.b - ((v - lo) / Math.max(hi - lo, 1)) * (H - PAD.t - PAD.b);
    const ticksY = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    const ticksX = Array.from({ length: 4 }, (_, i) => tMin + ((tMax - tMin) * i) / 3);
    return { t, x, y, lo, hi, tMin, tMax, ticksY, ticksX };
  }, [points]);

  if (!model) return null;
  const { x, y, ticksX, ticksY } = model;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(model.t[i]).toFixed(1)},${y(p.avgRisk).toFixed(1)}`).join(' ');
  const area = `${line} L${x(model.t[points.length - 1]).toFixed(1)},${H - PAD.b} L${x(model.t[0]).toFixed(1)},${H - PAD.b} Z`;
  const span = model.tMax - model.tMin;
  const fmtX = (ms) => new Date(ms).toLocaleString('en-IN', span > 86_400_000 * 2 ? { day: '2-digit', month: 'short' } : { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`Average monitored risk score over time, ${points.length} snapshots, latest ${points[points.length - 1].avgRisk}`}>
        <defs>
          <linearGradient id="trajFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.l - 8} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#8b93a7">{v.toFixed(1)}</text>
          </g>
        ))}
        {ticksX.map((ms) => <text key={ms} x={x(ms)} y={H - 10} textAnchor="middle" fontSize="10" fill="#8b93a7">{fmtX(ms)}</text>)}
        <text x={12} y={H / 2} fontSize="10" fill="#8b93a7" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">Avg risk score (0–100)</text>

        {points.length > 1 && <path d={area} fill="url(#trajFill)" />}
        {points.length > 1 && <path d={line} fill="none" stroke="#d4af37" strokeWidth="2" strokeLinejoin="round" />}
        {points.map((p, i) => (
          <circle key={p.at} cx={x(model.t[i])} cy={y(p.avgRisk)} r={hover?.i === i ? 5 : 3} fill="#d4af37" stroke="#0a1428" strokeWidth="1.5"
            tabIndex={0} aria-label={`${fmt.date(p.at)}: average risk ${p.avgRisk}, ${p.critical} critical`}
            onMouseEnter={() => setHover({ i })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ i })} onBlur={() => setHover(null)} />
        ))}

        {annotations.map((a, i) => {
          const ms = Math.min(Math.max(new Date(a.at).getTime(), model.tMin), model.tMax);
          const col = SEV_COLOR[a.severity] || (a.kind === 'model' ? '#a78bfa' : '#8b93a7');
          return (
            <g key={`${a.at}-${i}`} tabIndex={0} role="button" aria-label={`${a.label}${a.simulated ? ' (simulated)' : ''}`}
              onClick={() => onSelectAnnotation?.(a)} onKeyDown={(e) => e.key === 'Enter' && onSelectAnnotation?.(a)} className="cursor-pointer">
              <line x1={x(ms)} x2={x(ms)} y1={PAD.t} y2={H - PAD.b} stroke={col} strokeOpacity="0.5" strokeDasharray={a.simulated ? '3 3' : '0'} />
              <path d={`M${x(ms)},${PAD.t} l5,-2 l-5,-3 l-5,3 z`} fill={col} transform="translate(0,8)" />
              <title>{`${a.label}${a.simulated ? ' · simulated' : ''} — ${fmt.date(a.at)}`}</title>
            </g>
          );
        })}
      </svg>

      {hover && (
        <div className="absolute top-2 right-3 card px-3 py-2 text-xs pointer-events-none">
          <div className="text-gray-400">{fmt.date(points[hover.i].at)}</div>
          <div className="text-white font-semibold tabular-nums">Avg risk {points[hover.i].avgRisk}</div>
          <div className="text-gray-400 tabular-nums">{fmt.int(points[hover.i].critical)} critical · {fmt.int(points[hover.i].high)} high</div>
          <div className="text-gray-500 tabular-nums">Exposure {fmt.inr(points[hover.i].exposureAtRisk)}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-gold" /> Average risk of monitored book</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rotate-45 bg-risk-critical" /> Alert raised</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rotate-45 bg-violet-400" /> Model retrained</span>
        <span>Dashed marker = simulated</span>
      </div>
    </div>
  );
}
