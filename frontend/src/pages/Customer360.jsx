import { Megaphone, ShieldAlert, User } from 'lucide-react';
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ActionWorkbench from '../components/ActionWorkbench';
import ExplainBars from '../components/ExplainBars';
import CustomerTimeline from '../components/CustomerTimeline';
import OutreachPanel from '../components/OutreachPanel';
import PageHeader from '../components/PageHeader';
import ScoreTrend from '../components/ScoreTrend';
import { useToast } from '../components/Toast';
import {
  Boundary, EmptyState, fmt, Provenance, RiskMeter, Section, SeverityBadge, Tabs,
} from '../components/ui';
import WhatIfSimulator from '../components/WhatIfSimulator';
import { useEvent } from '../lib/realtime';
import { useApi } from '../lib/useApi';

const OUTCOME_STYLES = {
  retained: 'bg-risk-low/15 text-risk-low',
  churned: 'bg-risk-critical/15 text-risk-critical',
  no_response: 'bg-gray-500/15 text-gray-400',
};

function Fact({ label, value, hint, proxy }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500 flex items-center gap-1.5">{label}{proxy && <Provenance kind="proxy" />}</dt>
      <dd className="text-sm text-gray-100 mt-0.5 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

/** Event-derived indicators when history exists; otherwise says so and shows the dataset profile fields, labelled. */
function Indicators({ customerId, data, version }) {
  const state = useApi(`/customers/${customerId}/features`, { params: { v: version } });
  return (
    <Section title="Recent behavioural indicators"
      hint="Computed from this customer's stored events. The source dataset has no event history, so most customers have none."
      action={state.data && <span className={`badge ${state.data.features.sufficiency === 'ok' ? 'bg-risk-low/15 text-risk-low' : 'bg-white/[0.06] text-gray-300'}`}>history: {fmt.label(state.data.features.sufficiency)}</span>}>
      <Boundary state={state} rows={3}>
        {({ features: f }) => (f.sufficiency === 'cold_start' ? (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 leading-relaxed">
              Only {f.events_total} event{f.events_total === 1 ? '' : 's'} on file, too few for rolling-window trends. Showing the dataset's own profile fields instead — these do not change over time.
            </p>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Fact label="Active member" value={data.isActiveMember ? 'Yes' : 'No'} hint="From the source dataset" />
              <Fact label="Last active" value={`${data.lastActiveDaysProxy} days ago`} proxy hint="Deterministic stand-in: the dataset has no activity dates" />
              <Fact label="Complaints on file" value={fmt.int(data.complaintCount)} />
              <Fact label="Outreach contacts" value={fmt.int(data.outreachCount)} />
            </dl>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Fact label="Days since activity" value={f.days_since_last_activity == null ? 'unknown' : fmt.dec(f.days_since_last_activity)} />
              <Fact label="Transactions 7d / 30d / 90d" value={`${f.windows['7d'].transactions} / ${f.windows['30d'].transactions} / ${f.windows['90d'].transactions}`} />
              <Fact label="Logins 7d / 30d / 90d" value={`${f.windows['7d'].logins} / ${f.windows['30d'].logins} / ${f.windows['90d'].logins}`} />
              <Fact label="Unresolved complaints" value={f.unresolved_complaints} />
              <Fact label="Balance now" value={f.balance_now == null ? 'unknown' : fmt.inr(f.balance_now)} />
              <Fact label="Balance change 30d" value={f.balance_change_pct_30d == null ? 'not comparable' : `${f.balance_change_pct_30d > 0 ? '+' : ''}${f.balance_change_pct_30d}%`} />
              <Fact label="Txn change vs prior 30d" value={f.txn_change_pct_30d_vs_prev30d == null ? 'not comparable' : `${f.txn_change_pct_30d_vs_prev30d}%`} />
              <Fact label="Abnormal balance moves" value={f.abnormal_balance_moves_30d} />
            </dl>
            <p className="text-[11px] text-gray-500">"Not comparable" means the history is too short for that comparison. Nothing is zero-filled.</p>
          </div>
        ))}
      </Boundary>
    </Section>
  );
}

function ComplaintsTable({ rows }) {
  if (!rows.length) return <EmptyState title="No complaints on file">Complaints raised for this customer will be listed here.</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table-modern">
        <thead><tr><th>ID</th><th>Subject</th><th>Severity</th><th>Status</th><th>Logged</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="font-mono text-xs text-gray-500">{c.id}</td>
              <td className="text-white max-w-[260px] truncate" title={c.subject}>{c.subject}</td>
              <td><SeverityBadge level={c.severity} /></td>
              <td className="text-gray-400 capitalize">{fmt.label(c.status)}</td>
              <td className="text-gray-500 text-xs whitespace-nowrap">{fmt.date(c.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2"><Link to="/complaints" className="text-xs text-gold hover:underline">Open the Resolve inbox →</Link></div>
    </div>
  );
}

function OutreachTable({ rows }) {
  if (!rows.length) return <EmptyState title="No outreach yet" icon={Megaphone}>Draft a recommendation from the Next best action panel. Nothing is sent without approval, and delivery is simulated in this demo.</EmptyState>;
  return (
    <div className="table-wrap" data-tour="outreach-history">
      <table className="table-modern">
        <thead><tr><th>#</th><th>Channel</th><th>Offer</th><th className="text-right">Score then</th><th>Outcome</th><th>When</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="text-gray-500">{a.id}</td>
              <td className="text-white whitespace-nowrap">{a.channelLabel}</td>
              <td className="text-gray-400 text-xs max-w-[180px] truncate" title={a.offerType}>{a.offerType}</td>
              <td className="tabular-nums text-gray-300 text-right">{a.riskScoreAtTrigger.toFixed(0)}</td>
              <td>
                {a.outcome ? <span className={`badge ${OUTCOME_STYLES[a.outcome] || 'bg-white/10 text-gray-300'}`}>{fmt.label(a.outcome)}</span> : <span className="text-gray-500 text-xs">{fmt.label(a.status)}</span>}
                {(a.simulated || a.outcomeObserved === false) && <span className="ml-1.5"><Provenance kind="simulated" /></span>}
              </td>
              <td className="text-gray-500 text-xs whitespace-nowrap">{fmt.date(a.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Customer360() {
  const { id } = useParams();
  const toast = useToast();
  const state = useApi(`/customers/${id}/360`);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState('timeline');
  const reload = () => { state.reload(); setVersion((v) => v + 1); };
  useEvent((e) => String(e.ref?.customerId) === String(id), reload);

  return (
    <Boundary state={state} rows={10}>
      {(d) => {
        const openComplaints = d.complaints.filter((c) => c.status !== 'resolved').length;
        return (
          <div>
            <PageHeader icon={User} title={d.surname}
              crumbs={[{ label: 'Retention', to: '/' }, { label: 'Churn Pulse', to: '/pulse' }, { label: d.accountNo }]}
              subtitle={`${d.accountNo} · ${d.branch} · ${fmt.label(d.segment)} · ${d.geography} · ${d.age} yrs · ${d.tenure} yr tenure`}
              action={<span data-tour="risk-badge"><SeverityBadge level={d.churnRiskLevel} /></span>} />

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
              {/* ------------------------------------------------ situation + evidence */}
              <div className="space-y-4 min-w-0">
                <section className="card p-5 reveal" style={{ '--i': 0 }} aria-label="Current situation">
                  <div className="grid sm:grid-cols-[210px_1fr] gap-6">
                    <div>
                      <div className="kicker mb-1">Churn risk now</div>
                      <div className="flex items-baseline gap-1.5 mb-3">
                        <span className="text-5xl font-bold tabular-nums text-white leading-none">{d.churnRiskScore.toFixed(0)}</span>
                        <span className="text-sm text-gray-500">/ 100</span>
                      </div>
                      <RiskMeter score={d.churnRiskScore} level={d.churnRiskLevel} />
                      <p className="text-[10px] text-gray-600 mt-1">Model ranking score, not a probability.</p>
                    </div>
                    <div className="min-w-0">
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-4 mb-4">
                        <Fact label="Balance" value={fmt.inr(d.balance)} />
                        <Fact label="Credit score" value={d.creditScore} />
                        <Fact label="Products" value={d.products.map(fmt.label).join(', ') || 'none'} />
                        <Fact label="Open complaints" value={openComplaints} />
                        <Fact label="RFM segment" value={d.rfm.segment} hint={`${d.rfm.loyaltyTokens} loyalty tokens`} />
                        <Fact label="Est. salary" value={fmt.inr(d.estimatedSalary)} />
                        <Fact label="Lifetime value" value={fmt.inr(d.lifetimeValue)} />
                        <Fact label="Contacts so far" value={d.outreachCount} />
                      </dl>
                      <div className="rounded-lg bg-gold/[0.06] border border-gold/15 px-3 py-2.5">
                        <div className="text-[11px] text-gold/80 uppercase tracking-wide font-semibold">Rule-based suggestion</div>
                        <div className="text-sm text-white">{d.recommendedAction}</div>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="reveal" style={{ '--i': 1 }} data-tour="why-risk">
                  <Section title="Why this score" hint="Evidence for this customer. The global model view is on Churn Pulse.">
                    <div className="grid xl:grid-cols-2 gap-6">
                      <div className="min-w-0">
                        <h3 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Risk drivers</h3>
                        <ul className="space-y-2 mb-5">
                          {d.churnDrivers.map((x) => (
                            <li key={x} className="text-[13px] text-gray-300 flex gap-2 items-start"><ShieldAlert size={14} className="text-risk-high mt-0.5 shrink-0" aria-hidden="true" />{x}</li>
                          ))}
                        </ul>
                        <ExplainBars customerId={d.customerId} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Risk trajectory</h3>
                        <ScoreTrend customerId={d.customerId} version={version} />
                      </div>
                    </div>
                  </Section>
                </div>

                <div className="reveal" style={{ '--i': 2 }}><Indicators customerId={d.customerId} data={d} version={version} /></div>

                <div className="card reveal" style={{ '--i': 3 }}>
                  <div className="px-5 pt-3">
                    <Tabs label="Customer history" value={tab} onChange={setTab} tabs={[
                      { id: 'timeline', label: 'Timeline' },
                      { id: 'complaints', label: 'Complaints', count: d.complaints.length },
                      { id: 'outreach', label: 'Outreach history', count: d.outreach.length },
                    ]} />
                  </div>
                  <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="p-5 pt-4 page-enter" key={tab}>
                    {tab === 'timeline' && <CustomerTimeline customerId={d.customerId} version={version} />}
                    {tab === 'complaints' && <ComplaintsTable rows={d.complaints} />}
                    {tab === 'outreach' && <OutreachTable rows={d.outreach} />}
                  </div>
                </div>
              </div>

              {/* ------------------------------------------------ next action rail */}
              <div className="space-y-4 min-w-0 lg:sticky lg:top-4 reveal" style={{ '--i': 1 }}>
                <Section title="Next best action" hint="Channel options ranked with reasons; a person approves before anything is recorded.">
                  <div className="rounded-lg bg-white/[0.03] border border-white/[0.07] px-3 py-2.5 mb-4">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Offer preview · {d.offer.offer_type}</div>
                    <p className="text-[13px] text-gray-300 leading-relaxed mt-1">{d.offer.message}</p>
                  </div>
                  <ActionWorkbench customerId={d.customerId} compact onChange={reload} />
                </Section>

                <Section title="What-if simulator" hint="Change an input and see how the score would respond. Nothing is saved.">
                  <div data-tour="simulator"><WhatIfSimulator customerId={d.customerId} baseline={d} /></div>
                </Section>

                <Section title="Quick outreach" hint="Direct trigger with the same safeguards." action={<Megaphone size={14} className="text-gold" aria-hidden="true" />}>
                  <div data-tour="outreach-panel">
                    <OutreachPanel customerId={d.customerId}
                      onTriggered={(r) => { reload(); toast(`Outreach #${r.action.id} recorded via ${r.action.channelLabel} · audit ${r.audit?.status}`, 'success'); }} />
                  </div>
                </Section>
              </div>
            </div>
          </div>
        );
      }}
    </Boundary>
  );
}
