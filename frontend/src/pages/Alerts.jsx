import { BellRing, ExternalLink, Search, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { client } from '../api/client';
import ActionWorkbench from '../components/ActionWorkbench';
import CustomerTimeline from '../components/CustomerTimeline';
import PageHeader from '../components/PageHeader';
import { useToast } from '../components/Toast';
import {
  Boundary, Chip, EmptyState, fmt, Provenance, Section, SeverityBadge,
} from '../components/ui';
import { useDebounce } from '../lib/hooks';
import { useEvent } from '../lib/realtime';
import { errorText, useApi } from '../lib/useApi';

const TRIGGER = {
  high_risk: 'Crossed risk band', risk_jump: 'Sharp score rise', inactivity: 'Inactivity',
  balance_decline: 'Balance decline', complaint_spike: 'Complaint spike',
};
const STATUS_TONE = {
  open: 'bg-risk-critical/15 text-risk-critical', acknowledged: 'bg-risk-medium/15 text-risk-medium',
  in_progress: 'bg-gold/15 text-gold', resolved: 'bg-risk-low/15 text-risk-low', dismissed: 'bg-gray-500/15 text-gray-400',
};
const NEXT = {
  open: ['acknowledged', 'in_progress', 'resolved', 'dismissed'],
  acknowledged: ['in_progress', 'resolved', 'dismissed'],
  in_progress: ['resolved', 'dismissed'],
  resolved: ['open'], dismissed: ['open'],
};

function EvidenceTable({ evidence }) {
  const f = evidence?.features;
  if (!f) return null;
  const rows = [
    ['History available', `${f.events_total} events over ${f.history_span_days} days (${f.sufficiency.replace('_', ' ')})`],
    ['Days since last activity', f.days_since_last_activity == null ? 'unknown' : `${f.days_since_last_activity}`],
    ['Logins 7d / 30d / 90d', ['7d', '30d', '90d'].map((w) => f.windows[w].logins).join(' / ')],
    ['Transactions 7d / 30d / 90d', ['7d', '30d', '90d'].map((w) => f.windows[w].transactions).join(' / ')],
    ['Txn change, 30d vs prior 30d', f.txn_change_pct_30d_vs_prev30d == null ? 'not computable' : `${f.txn_change_pct_30d_vs_prev30d}%`],
    ['Balance change over 30d', f.balance_change_pct_30d == null ? 'not computable' : `${f.balance_change_pct_30d}% (${fmt.inr(f.balance_30d_ago)} → ${fmt.inr(f.balance_now)})`],
    ['Abnormal balance moves (30d)', f.abnormal_balance_moves_30d],
    ['Complaints logged 30d / unresolved', `${f.windows['30d'].complaints_logged} / ${f.unresolved_complaints}`],
  ];
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
      {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-white/[0.04] pb-1.5"><dt className="text-gray-500">{k}</dt><dd className="text-gray-200 text-right tabular-nums">{v}</dd></div>)}
    </dl>
  );
}

function Drawer({ id, onClose, onChanged }) {
  const toast = useToast();
  const detail = useApi(`/alerts/${id}`);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(null);
  const [assignee, setAssignee] = useState('');
  const [version, setVersion] = useState(0);
  const a = detail.data;

  useEvent((e) => e.ref?.alertId === id, () => { detail.reload(); setVersion((v) => v + 1); });
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const act = async (fn, ok) => {
    try { await fn(); toast(ok, 'success'); setNote(''); setPending(null); detail.reload(); onChanged(); setVersion((v) => v + 1); }
    catch (err) { toast(errorText(err), 'error', 6000); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Alert detail">
      <button className="flex-1 bg-black/55" onClick={onClose} aria-label="Close detail" />
      <div className="w-full max-w-[640px] h-full overflow-y-auto bg-navy border-l border-white/10 panel-enter">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 bg-navy/95 backdrop-blur border-b border-white/10">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{id}{a ? ` · ${a.surname || 'CUST-' + a.customerId}` : ''}</div>
            {a && <div className="text-[11px] text-gray-500">{a.branch} · raised {fmt.ago(a.createdAt)}</div>}
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-6">
          <Boundary state={detail} rows={8}>
            {(x) => (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge level={x.severity} />
                  <span className={`badge ${STATUS_TONE[x.status]}`}>{fmt.label(x.status)}</span>
                  {x.simulated && <Provenance kind="simulated">Simulated scenario</Provenance>}
                  <Provenance kind={x.dataSource === 'events' ? 'observed' : x.dataSource === 'simulator' ? 'simulated' : 'model'}>{x.dataSource} data</Provenance>
                  {x.quality !== 'ok' && <span className="badge bg-risk-high/10 text-risk-high" title="Little event history behind this alert">{x.quality} history</span>}
                  <Link to={`/customers/${x.customerId}`} className="ml-auto text-xs text-gold hover:underline flex items-center gap-1">Customer profile <ExternalLink size={11} /></Link>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="card p-3"><div className="text-[11px] text-gray-500">Risk score</div><div className="text-2xl font-bold tabular-nums text-white">{x.riskScore.toFixed(0)}</div></div>
                  <div className="card p-3"><div className="text-[11px] text-gray-500">Previous</div><div className="text-2xl font-bold tabular-nums text-gray-300">{x.previousRiskScore == null ? '—' : x.previousRiskScore.toFixed(0)}</div></div>
                  <div className="card p-3"><div className="text-[11px] text-gray-500">Change</div><div className={`text-2xl font-bold tabular-nums ${x.scoreChange > 0 ? 'text-risk-critical' : 'text-risk-low'}`}>{x.scoreChange == null ? '—' : `${x.scoreChange > 0 ? '+' : ''}${x.scoreChange}`}</div></div>
                </div>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Why this alert exists</h3>
                  <ul className="space-y-1.5">
                    {x.explanation.map((t) => <li key={t.trigger} className="text-sm text-gray-200 flex gap-2"><span className="text-gold">▸</span><span><b className="font-medium">{TRIGGER[t.trigger] || t.trigger}:</b> {t.text}</span></li>)}
                  </ul>
                  <p className="text-xs text-gray-400 mt-3 leading-relaxed"><b className="text-gray-300">Suggested next step:</b> {x.recommendedAction}</p>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Evidence (as of {fmt.date(x.evidence?.features?.as_of)})</h3>
                  <EvidenceTable evidence={x.evidence} />
                  <p className="text-[11px] text-gray-500 mt-2">Scoring pathway: {x.evidence?.scoring_pathway}. Scores are an uncalibrated risk ranking, not a probability of leaving.</p>
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Case handling</h3>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {NEXT[x.status].map((s) => (
                      <button key={s} onClick={() => ['resolved', 'dismissed'].includes(s) ? setPending(s) : act(() => client.post(`/alerts/${id}/status`, { status: s }), `Alert ${fmt.label(s)}`)}
                        className={`btn-chip border ${pending === s ? 'border-gold text-gold bg-gold/10' : 'border-white/10 bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]'}`}>
                        {s === 'open' ? 'Reopen' : fmt.label(s)}
                      </button>
                    ))}
                  </div>
                  {pending && (
                    <div className="flex gap-2 mb-3">
                      <input className="input-field text-sm py-1.5" autoFocus maxLength={1000} placeholder={`Reason for marking ${pending} (required)`} aria-label="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
                      <button disabled={!note.trim()} className="btn-primary px-3 text-xs" onClick={() => act(() => client.post(`/alerts/${id}/status`, { status: pending, note }), `Alert ${pending}`)}>Confirm</button>
                    </div>
                  )}
                  <div className="flex gap-2 mb-2">
                    <input className="input-field text-sm py-1.5" placeholder={x.assignee ? `Assigned to ${x.assignee}` : 'Assign to…'} aria-label="Assignee" maxLength={60} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
                    <button disabled={!assignee.trim()} className="btn-ghost px-3 text-xs" onClick={() => act(() => client.post(`/alerts/${id}/assign`, { assignee }), 'Assigned').then(() => setAssignee(''))}>Assign</button>
                  </div>
                  {!pending && (
                    <div className="flex gap-2">
                      <input className="input-field text-sm py-1.5" placeholder="Add investigator note" aria-label="Investigator note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                      <button disabled={!note.trim()} className="btn-ghost px-3 text-xs" onClick={() => act(() => client.post(`/alerts/${id}/notes`, { note }), 'Note added')}>Add</button>
                    </div>
                  )}
                  {x.resolutionReason && <p className="text-xs text-gray-400 mt-2">Closed with reason: “{x.resolutionReason}”</p>}
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Intervention</h3>
                  <ActionWorkbench customerId={x.customerId} alertId={x.id} compact onChange={() => setVersion((v) => v + 1)} />
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Customer timeline</h3>
                  <CustomerTimeline customerId={x.customerId} version={version} />
                </section>

                <section>
                  <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Case history</h3>
                  <ol className="space-y-2">
                    {x.history.slice().reverse().map((h, i) => (
                      <li key={i} className="text-xs text-gray-400"><span className="text-gray-600 tabular-nums">{fmt.date(h.at)}</span> · <b className="text-gray-200 font-medium">{h.actor}</b>{h.from !== h.to ? ` moved ${h.from || 'new'} → ${h.to}` : ''}{h.note ? ` — ${h.note}` : ''}</li>
                    ))}
                  </ol>
                </section>
              </>
            )}
          </Boundary>
        </div>
      </div>
    </div>
  );
}

export default function Alerts() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('active');
  const [severity, setSeverity] = useState('');
  const [sort, setSort] = useState('severity');
  const [q, setQ] = useState('');
  const [simOnly, setSimOnly] = useState(true);
  const dq = useDebounce(q, 300);
  const openId = params.get('open');

  const list = useApi('/alerts', { params: { status: status === 'all' ? undefined : status, severity: severity || undefined, q: dq || undefined, sort, include_simulated: simOnly, limit: 100 } });
  const summary = useApi('/alerts/summary');
  useEvent(['alert_created', 'alert_updated'], () => { list.reload(); summary.reload(); });

  const refresh = () => { list.reload(); summary.reload(); };
  const setOpen = (id) => setParams(id ? { open: id } : {}, { replace: true });
  const s = summary.data;
  const rows = list.data?.alerts || [];

  return (
    <div>
      <PageHeader icon={BellRing} title="Early warning" crumbs={[{ label: 'Retention', to: '/' }, { label: 'Early warning' }]}
        subtitle="Persistent alerts, each created by a named trigger and stored with the evidence that fired it. Nothing here is generated to fill the screen." />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[['Active', s?.active, ''], ['Critical', s?.bySeverity?.critical, 'text-risk-critical'], ['High', s?.bySeverity?.high, 'text-risk-high'], ['Awaiting triage', s?.open, 'text-gold']].map(([l, v, c]) => (
          <div key={l} className="card p-3.5"><div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{l}</div><div className={`text-2xl font-bold tabular-nums ${c || 'text-white'}`}>{v ?? '—'}</div></div>
        ))}
      </div>

      <Section title="Alert queue" hint={list.data ? `${list.data.total} matching` : undefined}>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input className="input-field py-1.5 pl-8 text-sm" placeholder="Search customer or alert ID" aria-label="Search alerts" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status filter">
            {['active', 'open', 'acknowledged', 'in_progress', 'resolved', 'dismissed', 'all'].map((v) => <Chip key={v} active={status === v} onClick={() => setStatus(v)}>{fmt.label(v)}</Chip>)}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Severity filter">
            {['', 'critical', 'high', 'medium'].map((v) => <Chip key={v || 'any'} active={severity === v} onClick={() => setSeverity(v)}>{v || 'any severity'}</Chip>)}
          </div>
          <select className="input-field w-auto py-1.5 text-sm" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="severity">Sort: severity</option><option value="recent">Sort: newest</option><option value="score">Sort: risk score</option><option value="change">Sort: score change</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-400"><input type="checkbox" checked={simOnly} onChange={(e) => setSimOnly(e.target.checked)} /> Include simulated</label>
        </div>

        <Boundary state={list} rows={5} isEmpty={() => rows.length === 0}
          empty={<EmptyState icon={BellRing} title={s?.total ? 'No alerts match these filters' : 'No alerts yet — and that is correct'}
            action={!s?.total && <Link to="/scenarios" className="btn-primary px-3 py-1.5 text-xs inline-block">Run a scenario</Link>}>
            {s?.total ? 'Try widening the status or severity filters.' : 'A customer is only alerted when a specific trigger fires: a risk band crossing, a sharp score rise, inactivity, a balance decline or a complaint spike. Real customers are first baselined, then watched for change. The Scenario Studio replays a clearly-labelled simulated journey so you can see the whole chain.'}
          </EmptyState>}>
          {() => (
            <div className="table-wrap">
              <table className="table-modern">
                <thead><tr><th>Severity</th><th>Customer</th><th>Trigger</th><th className="text-right">Risk</th><th>Status</th><th>Source</th><th>Raised</th></tr></thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} aria-selected={openId === a.id} className="cursor-pointer" onClick={() => setOpen(a.id)}
                      tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(a.id))}>
                      <td><SeverityBadge level={a.severity} /></td>
                      <td className="max-w-[220px]"><div className="text-white truncate">{a.surname || `CUST-${a.customerId}`}</div><div className="text-[11px] text-gray-500 truncate">{a.id} · {a.branch}</div></td>
                      <td className="max-w-[320px]"><div className="text-gray-200">{TRIGGER[a.trigger] || a.trigger}</div><div className="text-[11px] text-gray-500 truncate-2">{a.explanation[0]?.text}</div></td>
                      <td className="text-right tabular-nums">{a.riskScore.toFixed(0)}{a.scoreChange != null && <div className={`text-[11px] ${a.scoreChange > 0 ? 'text-risk-critical' : 'text-risk-low'}`}>{a.scoreChange > 0 ? '+' : ''}{a.scoreChange}</div>}</td>
                      <td><span className={`badge ${STATUS_TONE[a.status]}`}>{fmt.label(a.status)}</span>{a.assignee && <div className="text-[11px] text-gray-500 mt-0.5">{a.assignee}</div>}</td>
                      <td>{a.simulated ? <Provenance kind="simulated" /> : <Provenance kind={a.dataSource === 'events' ? 'observed' : 'model'}>{a.dataSource}</Provenance>}</td>
                      <td className="text-xs text-gray-500 whitespace-nowrap">{fmt.ago(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Boundary>
      </Section>

      {openId && <Drawer id={openId} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}
