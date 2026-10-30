import { Beaker } from 'lucide-react';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionRow } from './ActionWorkbench';
import {
  Boundary, Chip, EmptyState, fmt, Provenance, Section,
} from './ui';
import { useEvent } from '../lib/realtime';
import { useApi } from '../lib/useApi';

const STATUSES = ['', 'recommended', 'approved', 'delivered', 'withheld', 'dismissed'];

export function WorkbenchTab() {
  const [status, setStatus] = useState('');
  const state = useApi('/workbench/actions', { params: { status: status || undefined } });
  useEvent(['outreach_approved', 'outreach_triggered', 'outreach_outcome'], () => state.reload());
  const rows = state.data?.actions || [];

  return (
    <Section title="Retention workbench"
      hint={state.data ? `Cooldown ${state.data.cooldownDays} days · max ${state.data.maxContacts30d} contacts per 30 days · ${state.data.holdoutPct}% holdout for measurement` : undefined}>
      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Status filter">
        {STATUSES.map((s) => <Chip key={s || 'all'} active={status === s} onClick={() => setStatus(s)}>{s || 'all'}</Chip>)}
      </div>
      <Boundary state={state} rows={4} isEmpty={() => rows.length === 0}
        empty={<EmptyState title="No outreach actions yet" icon={Beaker}
          action={<Link to="/alerts" className="btn-primary px-3 py-1.5 text-xs inline-block">Open early warning</Link>}>
          Actions start from an alert or a customer profile: draft a recommendation, edit and approve it, then record the simulated delivery and the outcome. Nothing is created automatically.
        </EmptyState>}>
        {() => (
          <ul className="grid lg:grid-cols-2 gap-3">
            {rows.map((a) => (
              <div key={a.id}>
                <div className="text-[11px] text-gray-500 mb-1">
                  <Link to={`/customers/${a.customerId}`} className="text-gray-300 hover:text-gold">{a.surname || `CUST-${a.customerId}`}</Link>
                  {' · '}{fmt.label(a.segment)} · risk at trigger {a.riskAtTrigger.toFixed(0)}
                </div>
                <ActionRow a={a} onChanged={state.reload} />
              </div>
            ))}
          </ul>
        )}
      </Boundary>
    </Section>
  );
}

function GroupCard({ title, g, tone }) {
  return (
    <div className="card p-4">
      <div className={`text-[11px] uppercase tracking-wide font-semibold ${tone}`}>{title}</div>
      <div className="text-3xl font-bold tabular-nums text-white mt-1">{g.retentionRate == null ? 'n/a' : fmt.pct(g.retentionRate, 0)}</div>
      <div className="text-xs text-gray-500">{g.ci95 ? `95% CI ${fmt.pct(g.ci95[0], 0)}–${fmt.pct(g.ci95[1], 0)}` : 'no measured outcomes'}</div>
      <dl className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
        {[['Assigned', g.assigned], ['Measured', g.measured], ['Pending', g.pending], ['Retained', g.retained], ['Churned', g.churned], ['No window data', g.missingAfterWindow]].map(([k, v]) => (
          <div key={k}><dt className="text-gray-500">{k}</dt><dd className="text-gray-200 tabular-nums">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function Breakdown({ title, data }) {
  const rows = Object.entries(data || {});
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-gray-500">No treatment records yet.</p> : (
        <div className="table-wrap"><table className="table-modern text-xs">
          <thead><tr><th>Group</th><th className="text-right">Assigned</th><th className="text-right">Measured</th><th className="text-right">Retention</th><th className="text-right">95% CI</th></tr></thead>
          <tbody>{rows.map(([k, g]) => (
            <tr key={k}><td className="text-gray-200">{fmt.label(k)}</td><td className="text-right tabular-nums">{g.assigned}</td><td className="text-right tabular-nums">{g.measured}</td>
              <td className="text-right tabular-nums">{g.retentionRate == null ? 'n/a' : fmt.pct(g.retentionRate, 0)}</td>
              <td className="text-right tabular-nums text-gray-500">{g.ci95 ? `${fmt.pct(g.ci95[0], 0)}–${fmt.pct(g.ci95[1], 0)}` : '—'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function ExperimentTab() {
  const state = useApi('/experiments/report');
  useEvent(['outreach_outcome', 'outreach_triggered'], () => state.reload());
  return (
    <Boundary state={state} rows={6}>
      {(r) => (
        <div className="space-y-4">
          {!r.sampleAdequate && (
            <div className="rounded-lg border border-risk-high/30 bg-risk-high/[0.06] px-4 py-3 text-sm text-gray-200" role="note">
              <b className="text-risk-high">Sample too small to conclude anything.</b> Each group needs at least {r.minGroupSize} measured outcomes. Everything below is illustrative and is shown with its sample size.
            </div>
          )}
          <div className="grid md:grid-cols-3 gap-3">
            <GroupCard title="Treatment (contacted)" g={r.treatment} tone="text-gold" />
            <GroupCard title="Holdout (not contacted)" g={r.holdout} tone="text-gray-400" />
            <div className="card p-4">
              <div className="text-[11px] uppercase tracking-wide font-semibold text-risk-medium">Difference</div>
              {r.comparison.computable ? (
                <>
                  <div className="text-3xl font-bold tabular-nums text-white mt-1">{r.comparison.absoluteDifferencePts > 0 ? '+' : ''}{r.comparison.absoluteDifferencePts} pts</div>
                  <div className="text-xs text-gray-500">95% CI {r.comparison.ci95Pts[0]} to {r.comparison.ci95Pts[1]} pts{r.comparison.relativeDifferencePct != null && ` · ${r.comparison.relativeDifferencePct}% relative`}</div>
                  <p className="text-xs text-gray-300 mt-2">{r.comparison.interpretation}</p>
                </>
              ) : <p className="text-sm text-gray-400 mt-2">Not computable. {r.comparison.reason}</p>}
            </div>
          </div>

          <Section title="Breakdown (treatment group)" hint="Same counting rules; a customer appears once per campaign.">
            <div className="grid lg:grid-cols-3 gap-6">
              <Breakdown title="By channel" data={r.byChannel} />
              <Breakdown title="By segment" data={r.bySegment} />
              <Breakdown title="By campaign" data={r.byCampaign} />
            </div>
          </Section>

          <Section title="How to read this" action={r.excludedSimulatedOutcomes ? <Provenance kind="simulated">{r.excludedSimulatedOutcomes} simulated outcome(s) excluded</Provenance> : null}>
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-xs">
              {Object.entries(r.methodology).map(([k, v]) => <div key={k}><dt className="text-gray-500 capitalize">{k}</dt><dd className="text-gray-300">{v}</dd></div>)}
            </dl>
            <ul className="list-disc pl-5 mt-4 space-y-1 text-xs text-gray-400">{r.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          </Section>
        </div>
      )}
    </Boundary>
  );
}
