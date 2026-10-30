import { Box, Square } from 'lucide-react';
import React, { lazy, Suspense, useMemo, useState } from 'react';
import { buildNetwork, SEVERITY_HEX, webglAvailable } from '../lib/networkLayout';
import { useApi } from '../lib/useApi';
import {
  Boundary, Chip, fmt, LoadingBlock, SEVERITY, SEVERITY_ORDER,
} from './ui';

const Scene3D = lazy(() => import('./SignalNetwork3D'));

class SceneBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() { this.props.onFail?.(); }

  render() { return this.state.failed ? null : this.props.children; }
}

function Tip({ tip }) {
  if (!tip) return null;
  const left = Math.min(tip.x + 14, 9999);
  return (
    <div className="absolute z-10 card px-3 py-2 text-xs pointer-events-none max-w-[240px]" style={{ left, top: tip.y + 14 }} role="status">
      {tip.kind === 'hub' ? (
        <>
          <div className="text-gold font-semibold">{tip.hub.name}</div>
          {tip.hub.stats ? (
            <div className="text-gray-300 tabular-nums">
              {fmt.int(tip.hub.stats.customers)} customers · {fmt.int(tip.hub.stats.critical)} critical<br />
              avg score {tip.hub.stats.avg_risk} · {fmt.inr(tip.hub.stats.balance)}
            </div>
          ) : <div className="text-gray-500">No branch totals available</div>}
        </>
      ) : (
        <>
          <div className="text-white font-semibold">{tip.node.c.surname} <span className="font-mono text-[10px] text-gray-500">{tip.node.c.accountNo}</span></div>
          <div className="text-gray-300">{tip.node.c.branch}</div>
          <div className="tabular-nums" style={{ color: SEVERITY_HEX[tip.node.c.churnRiskLevel] }}>Score {tip.node.c.churnRiskScore.toFixed(0)} · {tip.node.c.churnRiskLevel}</div>
          <div className="text-gray-400 tabular-nums">{fmt.inr(tip.node.c.balance)} balance</div>
          {tip.node.alert && <div className="text-risk-critical">Open early-warning alert</div>}
          <div className="text-gray-500 mt-0.5">Click to open evidence</div>
        </>
      )}
    </div>
  );
}

/** Static top-down projection of the same layout: the fallback when WebGL is unavailable or 2D is chosen. */
function Network2D({ net, selectedId, onHover, onSelect }) {
  const R = 16;
  return (
    <svg viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`} className="w-full h-full" role="group"
      aria-label="Top-down map: customers cluster around their branch; closer to the branch core means a higher risk score; larger means a bigger balance">
      <circle r="11" fill="none" stroke="rgba(255,255,255,0.05)" />
      {net.nodes.map((n) => <line key={`l${n.c.customerId}`} x1={n.hub.x} y1={n.hub.z} x2={n.x} y2={n.z} stroke="#8b93a7" strokeOpacity="0.08" strokeWidth="0.03" />)}
      {net.nodes.map((n) => {
        const sel = n.c.customerId === selectedId;
        return (
          <g key={n.c.customerId}>
            {n.alert && <circle cx={n.x} cy={n.z} r={n.size * 3.2} fill="none" stroke="#fff" strokeWidth="0.06" />}
            <circle cx={n.x} cy={n.z} r={n.size * (sel ? 2.4 : 1.5)} fill={SEVERITY_HEX[n.c.churnRiskLevel]} stroke={sel ? '#fff' : 'none'} strokeWidth="0.08"
              tabIndex={n.alert ? 0 : -1} role="button" aria-label={`${n.c.surname}, score ${n.c.churnRiskScore.toFixed(0)}, ${n.c.churnRiskLevel}${n.alert ? ', open alert' : ''}`}
              className="cursor-pointer" onClick={() => onSelect(n.c)} onKeyDown={(e) => e.key === 'Enter' && onSelect(n.c)}
              onMouseMove={(e) => { const b = e.currentTarget.ownerSVGElement.getBoundingClientRect(); onHover({ kind: 'customer', node: n, x: e.clientX - b.left, y: e.clientY - b.top }); }}
              onMouseLeave={() => onHover(null)} />
          </g>
        );
      })}
      {net.hubs.map((h) => (
        <g key={h.name} onMouseMove={(e) => { const b = e.currentTarget.ownerSVGElement.getBoundingClientRect(); onHover({ kind: 'hub', hub: h, x: e.clientX - b.left, y: e.clientY - b.top }); }} onMouseLeave={() => onHover(null)}>
          <path d={`M${h.x},${h.z - 0.5} l0.5,0.5 l-0.5,0.5 l-0.5,-0.5 z`} fill="#d4af37" />
          <text x={h.x} y={h.z + 1.6} textAnchor="middle" fontSize="0.7" fill="#f0d878">{h.name}</text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Retention Signal Network. Real data only: the top customers by model score, grouped by branch.
 * Position and size are derived from score and balance (see lib/networkLayout.js); selecting a node
 * hands the customer to the parent so it drives the same evidence panel as the ranking table.
 */
export default function SignalNetwork({ selectedId, onSelect, perLevel = 250 }) {
  const crit = useApi('/customers', { params: { sort: 'risk', order: 'desc', limit: perLevel, riskLevel: 'critical' } });
  const high = useApi('/customers', { params: { sort: 'risk', order: 'desc', limit: perLevel, riskLevel: 'high' } });
  const merged = useMemo(() => (crit.data && high.data
    ? { customers: [...crit.data.customers, ...high.data.customers], total: crit.data.total + high.data.total } : null), [crit.data, high.data]);
  const customers = { data: merged, loading: crit.loading || high.loading, error: crit.error || high.error, reload: () => { crit.reload(); high.reload(); } };
  const [level, setLevel] = useState('');
  const branches = useApi('/customers/branches');
  const alerts = useApi('/alerts', { params: { status: 'active', limit: 200 } });
  const [mode, setMode] = useState(() => (webglAvailable() ? '3d' : '2d'));
  const [tip, setTip] = useState(null);

  const net = useMemo(() => {
    if (!customers.data?.customers?.length || !branches.data) return null;
    const ids = new Set((alerts.data?.alerts || []).map((a) => a.customerId));
    const rows = customers.data.customers.filter((c) => !level || c.churnRiskLevel === level);
    return rows.length ? buildNetwork(rows, branches.data.branches, ids) : null;
  }, [customers.data, branches.data, alerts.data, level]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400" aria-label="Legend">
          {SEVERITY_ORDER.slice(0, 2).map((k) => <li key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY[k].color }} />{SEVERITY[k].label}</li>)}
          <li className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rotate-45 bg-gold" />Branch</li>
          <li className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border border-white" />Open alert</li>
        </ul>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Severity shown">
          {[['', 'Critical + high'], ['critical', 'Critical'], ['high', 'High']].map(([v, l]) => <Chip key={v} active={level === v} onClick={() => setLevel(v)}>{l}</Chip>)}
        </div>
        <div className="flex gap-1.5" role="group" aria-label="View">
          <Chip active={mode === '3d'} onClick={() => setMode('3d')} disabled={!webglAvailable()} title={webglAvailable() ? '' : 'WebGL is not available in this browser'}><Box size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />3D</Chip>
          <Chip active={mode === '2d'} onClick={() => setMode('2d')}><Square size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />2D map</Chip>
        </div>
      </div>

      <Boundary state={customers} rows={6} isEmpty={() => !net} empty={<LoadingBlock rows={6} />}>
        {() => net && (
          <>
            <div className="relative h-[420px] sm:h-[480px] rounded-lg bg-black/20 border border-white/[0.06] overflow-hidden touch-none" onMouseLeave={() => setTip(null)}>
              {mode === '3d' ? (
                <SceneBoundary onFail={() => setMode('2d')}>
                  <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">Loading 3D view…</div>}>
                    <Scene3D net={net} selectedId={selectedId} onHover={setTip} onSelect={onSelect} />
                  </Suspense>
                </SceneBoundary>
              ) : <Network2D net={net} selectedId={selectedId} onHover={setTip} onSelect={onSelect} />}
              <Tip tip={tip} />
              <div className="absolute bottom-2 left-3 text-[10px] text-gray-500 pointer-events-none">{mode === '3d' ? 'Drag to rotate · scroll to zoom · click a node' : 'Top-down map · click a node'}</div>
            </div>
            <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
              Up to {perLevel} highest-scoring critical and {perLevel} highest-scoring high customers of {fmt.int(customers.data.total)} in those two bands, grouped by branch. Closer to the branch core = higher score
              ({net.scoreRange[0].toFixed(0)}–{net.scoreRange[1].toFixed(0)} in view); {mode === '3d' ? 'height and size = balance' : 'size = balance'}.
              Colour is severity and a ring marks an open alert. Only the top of each band is drawn, so this maps where the worst risk sits, not the whole book.
              Keyboard users can use the ranking table below, which lists the same customers.
            </p>
          </>
        )}
      </Boundary>
    </div>
  );
}
