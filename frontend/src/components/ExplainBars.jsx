import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import { useEvent } from '../lib/realtime';

function fmt(feature, v) {
  if (feature === 'Balance') return `₹${Math.round(v).toLocaleString('en-IN')}`;
  if (feature === 'Is Active Member' || feature === 'Has Credit Card') return v ? 'yes' : 'no';
  return String(v);
}

export default function ExplainBars({ customerId }) {
  const [data, setData] = useState(null);
  const load = () => client.get(`/customers/${customerId}/explain`).then((res) => setData(res.data));
  useEffect(() => { load(); }, [customerId]);
  useEvent((e) => String(e.ref?.customerId) === String(customerId) || e.type === 'model_retrained', load);

  if (!data) return <div className="skeleton h-28" />;
  const max = Math.max(1, ...data.contributions.map((c) => Math.abs(c.delta)));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">What would move the score</span>
        <span className="text-[11px] text-gray-500">baseline {data.baselineRisk}%</span>
      </div>
      {data.contributions.length === 0 ? (
        <p className="text-xs text-gray-500">All actionable features are already at healthy reference values.</p>
      ) : (
        <div className="space-y-2">
          {data.contributions.map((c) => {
            const reduces = c.delta < 0;
            const w = (Math.abs(c.delta) / max) * 100;
            return (
              <div key={c.feature} className="grid grid-cols-[150px_1fr_58px] items-center gap-3 text-xs">
                <div className="min-w-0">
                  <div className="text-gray-200 truncate">{c.label}</div>
                  <div className="text-gray-500 truncate">now {fmt(c.feature, c.current)}</div>
                </div>
                <div className="relative h-2 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className={`absolute top-0 h-full rounded-full transition-all duration-500 ${reduces ? 'bg-risk-low right-1/2' : 'bg-risk-critical left-1/2'}`} style={{ width: `${w / 2}%` }} />
                  <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
                </div>
                <div className={`text-right tabular-nums font-semibold ${reduces ? 'text-risk-low' : 'text-risk-critical'}`}>{c.delta > 0 ? '+' : ''}{c.delta}</div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-gray-600 mt-2">{data.method}</p>
    </div>
  );
}
