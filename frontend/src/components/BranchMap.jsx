import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '../api/client';
import { useEvent } from '../lib/realtime';

const BRANCH_GEO = {
  'Mumbai Main': [72.8777, 19.076],
  'Delhi Connaught': [77.2167, 28.6315],
  'Bangalore MG Road': [77.6069, 12.9752],
  'Chennai Anna Nagar': [80.2101, 13.085],
  'Pune FC Road': [73.8413, 18.5236],
  'Hyderabad Banjara Hills': [78.4482, 17.4126],
  'Kolkata Park Street': [88.352, 22.5532],
};

const LABEL = {
  'Mumbai Main': { dx: 1, dy: -16, anchor: 'start' },
  'Pune FC Road': { dx: 1, dy: 18, anchor: 'start' },
  'Bangalore MG Road': { dx: -1, dy: 4, anchor: 'end' },
  'Chennai Anna Nagar': { dx: 1, dy: 4, anchor: 'start' },
  'Hyderabad Banjara Hills': { dx: 1, dy: -10, anchor: 'start' },
  'Delhi Connaught': { dx: 1, dy: 4, anchor: 'start' },
  'Kolkata Park Street': { dx: 1, dy: 4, anchor: 'start' },
};

const W = 520, H = 560;
const LON = [68, 97.5], LAT = [6, 37.5];
const proj = ([lon, lat]) => {
  const x = ((lon - LON[0]) / (LON[1] - LON[0])) * W;
  const merc = (v) => Math.log(Math.tan(Math.PI / 4 + (v * Math.PI) / 360));
  const y = H - ((merc(lat) - merc(LAT[0])) / (merc(LAT[1]) - merc(LAT[0]))) * H;
  return [x, y];
};

export default function BranchMap({ compact = false }) {
  const navigate = useNavigate();
  const [rings, setRings] = useState(null);
  const [branches, setBranches] = useState([]);
  const [pulses, setPulses] = useState({});
  const [hover, setHover] = useState(null);

  useEffect(() => {
    fetch('/india-outline.json').then((r) => r.json()).then((d) => setRings(d.rings)).catch(() => setRings([]));
    client.get('/customers/branches').then((res) => setBranches(res.data.branches));
  }, []);

  useEvent(['risk_changed', 'balance_moved', 'complaint_logged', 'outreach_triggered'], (e) => {
    const branch = e.ref?.branch;
    if (!branch) return;
    setPulses((p) => ({ ...p, [branch]: { at: Date.now(), severity: e.severity } }));
    setTimeout(() => setPulses((p) => { const n = { ...p }; delete n[branch]; return n; }), 3500);
    client.get('/customers/branches').then((res) => setBranches(res.data.branches));
  });

  const paths = useMemo(() => (rings || []).map((ring) => 'M' + ring.map((pt) => proj(pt).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z'), [rings]);
  const maxBal = Math.max(1, ...branches.map((b) => b.balance));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${compact ? 'max-h-[360px]' : 'max-h-[520px]'}`} style={{ aspectRatio: `${W}/${H}` }}>
        <defs>
          <radialGradient id="glow"><stop offset="0%" stopColor="#d4af37" stopOpacity="0.5" /><stop offset="100%" stopColor="#d4af37" stopOpacity="0" /></radialGradient>
        </defs>
        {paths.map((d, i) => <path key={i} d={d} fill="rgba(212,175,55,0.05)" stroke="rgba(212,175,55,0.35)" strokeWidth="1" />)}
        {rings && rings.length === 0 && <text x={W / 2} y={H / 2} fill="#8b93a7" fontSize="12" textAnchor="middle">Map outline unavailable</text>}

        {branches.map((b) => {
          const geo = BRANCH_GEO[b.branch];
          if (!geo) return null;
          const [x, y] = proj(geo);
          const r = 6 + 16 * Math.sqrt(b.balance / maxBal);
          const riskColor = b.avg_risk >= 45 ? '#f43f5e' : b.avg_risk >= 38 ? '#f59e0b' : '#34d399';
          const pulse = pulses[b.branch];
          return (
            <g key={b.branch} className="cursor-pointer" onClick={() => navigate(`/pulse?branch=${encodeURIComponent(b.branch)}`)} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}>
              {pulse && <circle cx={x} cy={y} r={r + 6} fill="none" stroke={pulse.severity === 'critical' ? '#f43f5e' : '#d4af37'} strokeWidth="2" opacity="0.9"><animate attributeName="r" from={r + 4} to={r + 30} dur="1.4s" repeatCount="2" /><animate attributeName="opacity" from="0.9" to="0" dur="1.4s" repeatCount="2" /></circle>}
              <circle cx={x} cy={y} r={r + 10} fill="url(#glow)" />
              <circle cx={x} cy={y} r={r} fill={riskColor} fillOpacity="0.22" stroke={riskColor} strokeWidth="1.5" />
              <circle cx={x} cy={y} r="3" fill="#fff" />
              {(() => {
                const l = LABEL[b.branch] || { dx: 1, dy: 4, anchor: 'start' };
                const lx = x + l.dx * (r + 6);
                return (
                  <>
                    <text x={lx} y={y + l.dy} fill="#e7eaf2" fontSize="11" fontFamily="Inter" fontWeight="600" textAnchor={l.anchor}>{b.branch.split(' ')[0]}</text>
                    <text x={lx} y={y + l.dy + 12} fill="#8b93a7" fontSize="9.5" fontFamily="Inter" textAnchor={l.anchor}>{b.critical} critical · {Math.round(b.avg_risk)}% avg</text>
                  </>
                );
              })()}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="absolute top-2 right-2 card px-3 py-2 text-xs fade-in">
          <div className="text-white font-semibold">{hover.branch}</div>
          <div className="text-gray-400">{hover.customers.toLocaleString()} customers · ₹{(hover.balance / 1e7).toFixed(2)}Cr</div>
          <div className="text-gray-400">{hover.critical} critical · avg risk {hover.avg_risk}%</div>
          <div className="text-gold mt-1">Click to filter Churn Pulse →</div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-risk-low" /> lower risk</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-risk-high" /> elevated</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-risk-critical" /> high</span>
        <span>· node size = balance · pulses on live events</span>
      </div>
    </div>
  );
}
