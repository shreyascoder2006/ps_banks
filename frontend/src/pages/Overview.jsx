import {
  Activity, ArrowRight, BellRing, LayoutDashboard, RefreshCw, ShieldAlert, ShieldCheck, Users, Wallet,
} from 'lucide-react';
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BranchMap from '../components/BranchMap';
import PageHeader from '../components/PageHeader';
import RiskTrajectory from '../components/RiskTrajectory';
import {
  Boundary, EmptyState, fmt, Kpi, Provenance, Section, SeverityBadge,
} from '../components/ui';
import { useEvent } from '../lib/realtime';
import { useApi } from '../lib/useApi';

const LEVELS = [
  ['critical', '#f43f5e'], ['high', '#f59e0b'], ['medium', '#38bdf8'], ['low', '#34d399'],
];
const TRIGGER_LABEL = {
  high_risk: 'Crossed risk band', risk_jump: 'Sharp score rise', inactivity: 'Inactivity',
  balance_decline: 'Balance decline', complaint_spike: 'Complaint spike',
};
const LIVE = ['alert_created', 'alert_updated', 'outreach_approved', 'outreach_triggered', 'outreach_outcome', 'model_retrained'];

function RiskBar({ levels, total }) {
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-white/5" role="img"
        aria-label={LEVELS.map(([l]) => `${levels[l]} ${l}`).join(', ')}>
        {LEVELS.map(([l, c]) => <div key={l} style={{ width: `${(levels[l] / total) * 100}%`, background: c }} title={`${l}: ${fmt.int(levels[l])}`} />)}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
        {LEVELS.map(([l, c]) => (
          <div key={l} className="flex items-center justify-between text-xs">
            <dt className="flex items-center gap-1.5 text-gray-400 capitalize"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}</dt>
            <dd className="tabular-nums text-gray-200">{fmt.int(levels[l])} <span className="text-gray-600">({((levels[l] / total) * 100).toFixed(0)}%)</span></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HBars({ rows, emptyText }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-xs text-gray-500 py-4">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-xs mb-1"><span className="text-gray-300">{r.label}</span><span className="tabular-nums text-gray-400">{fmt.int(r.value)}</span></div>
          <div className="h-1.5 rounded-full bg-white/5"><div className="h-full rounded-full bg-gold/80" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function ChannelTable({ retention }) {
  const rows = Object.entries(retention.byChannel || {});
  if (!rows.length) {
    return <EmptyState title="No outreach recorded yet" icon={ShieldCheck}>
      Approve and record outreach from an alert (or run the Scenario Studio). Results appear here with their sample size — nothing is estimated.
    </EmptyState>;
  }
  return (
    <div className="table-wrap">
      <table className="table-modern">
        <thead><tr><th>Channel</th><th className="text-right">Contacted</th><th className="text-right">Measured</th><th className="text-right">Pending</th><th className="text-right">Retention</th></tr></thead>
        <tbody>
          {rows.map(([k, v]) => {
            const measured = v.retained + v.churned + v.no_response;
            return (
              <tr key={k}>
                <td className="text-white">{v.label}</td>
                <td className="text-right tabular-nums">{v.sent}</td>
                <td className="text-right tabular-nums">{measured}</td>
                <td className="text-right tabular-nums text-gray-500">{v.pending}</td>
                <td className="text-right tabular-nums">{v.retention_rate == null ? <span className="text-gray-600">n/a</span> : fmt.pct(v.retention_rate, 0)}{measured > 0 && measured < 30 && <span className="text-gray-600"> · n={measured}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const state = useApi('/dashboard/overview', { refreshMs: 60000 });
  useEvent(LIVE, () => state.reload());
  const d = state.data;
  const k = d?.kpis;
  const obs = k?.observedRetention;

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        title="Retention overview"
        subtitle="From customer signal to alert, action and outcome — what needs attention now, and what the evidence supports."
        action={
          <button onClick={state.reload} className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5" aria-label="Refresh overview">
            <RefreshCw size={12} className={state.loading ? 'animate-spin' : ''} aria-hidden="true" />
            {d ? `Updated ${new Date(d.generatedAt).toLocaleTimeString()}` : 'Refresh'}
          </button>
        }
      />

      {state.error && !d && <Section title="Overview"><Boundary state={state}>{() => null}</Boundary></Section>}

      {/* A. executive KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-4" data-tour="kpis">
        <Kpi label="Customers monitored" value={fmt.int(k?.monitored)} loading={!d} sub="Scored by the churn model" />
        <Kpi label="High / critical risk" value={fmt.int(k?.highCritical)} loading={!d} tone="critical" onClick={() => navigate('/pulse')}
          sub={d && `${fmt.int(k.critical)} critical · ${fmt.int(k.high)} high`} />
        <Kpi label="Exposure at risk" value={fmt.inr(k?.exposureAtRisk)} loading={!d} tone="warn"
          sub={d && `${((k.exposureAtRisk / k.totalBalance) * 100).toFixed(0)}% of ${fmt.inr(k.totalBalance)} book`} />
        <Kpi label="New alerts" value={fmt.int(k?.newAlerts)} loading={!d} tone={k?.newAlerts ? 'critical' : 'default'}
          onClick={() => navigate('/alerts')} sub={d && `${k.activeAlerts} active in total`} />
        <Kpi label="Approved, awaiting action" value={fmt.int(k?.approvedAwaitingExecution)} loading={!d} onClick={() => navigate('/outreach')} sub="Human-approved outreach" />
        <Kpi label="Observed retention" loading={!d} tone="gold"
          value={obs?.rate == null ? 'n/a' : fmt.pct(obs.rate, 0)}
          sub={d && (obs.measured ? `${obs.measured} measured · ${obs.pending} pending${obs.sampleAdequate ? '' : ' · small sample'}` : 'No observed outcomes yet')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* B. trajectory (focal) */}
        <Section title="Risk trajectory" className="xl:col-span-8"
          hint="Average risk of the monitored book, one point per stored snapshot, with alerts and model events marked."
          action={d && <Provenance kind="model">Model scores</Provenance>}>
          <Boundary state={state} rows={6}>
            {(data) => data.trajectory.length === 0
              ? <EmptyState title="No snapshots yet" icon={Activity}>A snapshot is stored whenever this page loads (at most every 10 minutes). The trend builds as the system runs.</EmptyState>
              : (
                <>
                  <RiskTrajectory points={data.trajectory} annotations={data.annotations} onSelectAnnotation={(a) => a.ref?.alertId && navigate('/alerts')} />
                  {data.trajectory.length < 3 && <p className="text-[11px] text-gray-500 mt-2">Only {data.trajectory.length} snapshot(s) stored so far — this is a real series, it just has not had time to grow.</p>}
                </>
              )}
          </Boundary>
        </Section>

        {/* C. early-warning queue */}
        <Section title="Early-warning queue" className="xl:col-span-4" tour="watchlist"
          hint="Most urgent active alerts. Each names its trigger."
          action={<Link to="/alerts" className="text-xs text-gold hover:underline flex items-center gap-1">All alerts <ArrowRight size={11} /></Link>}>
          <div data-tour="watchlist">
            <Boundary state={state} rows={5}>
              {(data) => data.queue.length === 0
                ? <EmptyState title="No active alerts" icon={BellRing}>Alerts appear only when a specific trigger fires (a band crossing, inactivity, a balance drop, complaints). Run the Scenario Studio to see one.</EmptyState>
                : (
                  <ul className="-my-1 divide-y divide-white/[0.05]">
                    {data.queue.slice(0, 6).map((a) => (
                      <li key={a.id}>
                        <button onClick={() => navigate(`/alerts?open=${a.id}`)} className="w-full text-left py-2.5 flex items-start gap-3 hover:bg-white/[0.02] rounded-lg px-1 -mx-1">
                          <SeverityBadge level={a.severity} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-gray-100 truncate">{a.surname || `CUST-${a.customerId}`} <span className="text-gray-600 text-xs">· {a.branch}</span></div>
                            <div className="text-xs text-gray-500 truncate">{TRIGGER_LABEL[a.trigger] || a.trigger} · {a.explanation[0]?.text}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[11px] tabular-nums text-gray-400">{a.riskScore.toFixed(0)}{a.scoreChange != null && <span className={a.scoreChange > 0 ? 'text-risk-critical' : 'text-risk-low'}> ({a.scoreChange > 0 ? '+' : ''}{a.scoreChange})</span>}</span>
                              {a.simulated && <Provenance kind="simulated" />}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </Boundary>
          </div>
        </Section>

        {/* D. behavioural signals + risk mix */}
        <Section title="Risk mix" className="xl:col-span-4" hint="Current distribution across all monitored customers.">
          <Boundary state={state} rows={4}>{(data) => <RiskBar levels={data.riskLevels} total={Math.max(1, data.kpis.monitored)} />}</Boundary>
        </Section>

        <Section title="Behavioural signals" className="xl:col-span-4" hint="What is actually triggering alerts, and the evidence behind it.">
          <Boundary state={state} rows={4}>
            {(data) => (
              <div className="space-y-4">
                <HBars rows={Object.entries(data.signals.alertsByTrigger).map(([key, value]) => ({ label: TRIGGER_LABEL[key] || key, value }))}
                  emptyText="No active alerts, so no trigger breakdown." />
                <dl className="grid grid-cols-2 gap-2 text-xs border-t border-white/[0.05] pt-3">
                  <div><dt className="text-gray-500">Inactive members (dataset)</dt><dd className="text-gray-200 tabular-nums">{fmt.int(data.signals.inactiveMembers)}</dd></div>
                  <div><dt className="text-gray-500">With complaints</dt><dd className="text-gray-200 tabular-nums">{fmt.int(data.signals.customersWithComplaints)}</dd></div>
                  <div><dt className="text-gray-500">Events, last 30d</dt><dd className="text-gray-200 tabular-nums">{fmt.int(Object.values(data.signals.eventsLast30d).reduce((a, b) => a + b, 0))}</dd></div>
                  <div><dt className="text-gray-500">Of which simulated</dt><dd className="text-risk-high tabular-nums">{fmt.int(data.signals.simulatedEvents)}</dd></div>
                </dl>
              </div>
            )}
          </Boundary>
        </Section>

        <Section title="Branch network" className="xl:col-span-4" hint="Average risk by branch (dataset assignment).">
          <BranchMap />
        </Section>

        {/* E. retention performance */}
        <Section title="Retention performance" className="xl:col-span-7"
          hint="Observed outcomes only. Simulated outcomes are excluded; groups under 30 measured outcomes are flagged."
          action={d && d.retention.simulatedOutcomesExcluded > 0 && <Provenance kind="simulated">{d.retention.simulatedOutcomesExcluded} simulated excluded</Provenance>}>
          <Boundary state={state} rows={4}>
            {(data) => (
              <>
                <ChannelTable retention={data.retention} />
                <div className="mt-4 pt-3 border-t border-white/[0.05] text-xs text-gray-400 leading-relaxed">
                  {data.retention.experiment.comparison.computable
                    ? <>Treatment vs holdout: <b className="text-white">{data.retention.experiment.comparison.absoluteDifferencePts} pts</b> (95% CI {data.retention.experiment.comparison.ci95Pts.join(' to ')}) — {data.retention.experiment.comparison.interpretation}.</>
                    : <>Holdout comparison unavailable: {data.retention.experiment.comparison.reason} <Link to="/outreach?tab=experiment" className="text-gold hover:underline">Open experiment report</Link></>}
                </div>
              </>
            )}
          </Boundary>
        </Section>

        {/* F. recent audit events */}
        <Section title="Audit trail" className="xl:col-span-5" hint="Latest recorded actions (database audit; on-chain only when marked).">
          <Boundary state={state} rows={5} isEmpty={(x) => x.recent.length === 0} empty={<EmptyState title="No audited actions yet" icon={Users} />}>
            {(data) => (
              <ol className="space-y-2.5">
                {data.recent.slice(0, 8).map((r, i) => (
                  <li key={`${r.at}-${i}`} className="flex gap-3 text-xs">
                    <span className="text-gray-600 w-14 shrink-0 tabular-nums">{fmt.ago(r.at)}</span>
                    <span className="text-gray-300 min-w-0 truncate"><b className="text-gray-100 font-medium">{r.actor}</b> {fmt.label(r.action)} <span className="text-gray-500">{r.target}</span></span>
                    {r.onChain && <span className="badge bg-risk-low/10 text-risk-low shrink-0">on-chain</span>}
                  </li>
                ))}
              </ol>
            )}
          </Boundary>
        </Section>
      </div>
    </div>
  );
}
