import { Activity, AlertTriangle, BellRing, Gauge, Megaphone, MessagesSquare, Target } from 'lucide-react';
import React, { useState } from 'react';
import { useApi } from '../lib/useApi';
import { Boundary, Chip, EmptyState, fmt, Provenance } from './ui';

const KIND = {
  event: { icon: Activity, label: 'Activity', cls: 'text-risk-medium' },
  score: { icon: Gauge, label: 'Score', cls: 'text-gold' },
  alert: { icon: BellRing, label: 'Alerts', cls: 'text-risk-critical' },
  complaint: { icon: MessagesSquare, label: 'Complaints', cls: 'text-risk-high' },
  outreach: { icon: Megaphone, label: 'Outreach', cls: 'text-risk-low' },
  outcome: { icon: Target, label: 'Outcomes', cls: 'text-risk-low' },
};

/** Single chronological stream: events, score changes, alerts, complaints, outreach, outcomes. */
export default function CustomerTimeline({ customerId, version = 0 }) {
  const state = useApi(`/customers/${customerId}/timeline`, { params: { limit: 150, v: version } });
  const [hidden, setHidden] = useState(new Set());
  const toggle = (k) => setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Filter timeline">
        {Object.entries(KIND).map(([k, v]) => <Chip key={k} active={!hidden.has(k)} onClick={() => toggle(k)}>{v.label}</Chip>)}
      </div>
      <Boundary state={state} rows={5} isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title="Nothing on the timeline yet" icon={AlertTriangle}>Events appear here when they are ingested, when the customer is scored or alerted, or when a complaint or outreach is recorded.</EmptyState>}>
        {(d) => {
          const items = d.items.filter((i) => !hidden.has(i.kind));
          return (
            <ol className="relative border-l border-white/10 ml-2 space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {items.map((it, idx) => {
                const K = KIND[it.kind] || KIND.event;
                const Icon = K.icon;
                return (
                  <li key={`${it.at}-${idx}`} className="ml-4 relative">
                    <span className={`absolute -left-[25px] top-0.5 w-4 h-4 rounded-full bg-navy border border-white/20 flex items-center justify-center ${K.cls}`}><Icon size={9} aria-hidden="true" /></span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm text-gray-200">{it.title}</span>
                      {it.simulated && <Provenance kind="simulated" />}
                      {it.severity && <span className="text-[10px] uppercase tracking-wide text-gray-500">{it.severity}</span>}
                    </div>
                    <div className="text-[11px] text-gray-500">{fmt.date(it.at)}</div>
                  </li>
                );
              })}
              {items.length === 0 && <li className="ml-4 text-xs text-gray-500">All categories are hidden.</li>}
            </ol>
          );
        }}
      </Boundary>
    </div>
  );
}
