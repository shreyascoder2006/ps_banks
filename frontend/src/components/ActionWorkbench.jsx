import { Ban, Check, Megaphone, Send } from 'lucide-react';
import React, { useState } from 'react';
import { client } from '../api/client';
import { errorText, useApi } from '../lib/useApi';
import { useToast } from './Toast';
import { Boundary, EmptyState, fmt, Provenance } from './ui';

const STATUS_STYLE = {
  recommended: 'bg-risk-medium/15 text-risk-medium',
  approved: 'bg-gold/15 text-gold',
  delivered: 'bg-risk-low/15 text-risk-low',
  withheld: 'bg-gray-500/15 text-gray-300',
  dismissed: 'bg-gray-500/15 text-gray-400',
  failed: 'bg-risk-critical/15 text-risk-critical',
  executed: 'bg-risk-low/15 text-risk-low',
};

export function ActionRow({ a, onChanged }) {
  const toast = useToast();
  const [message, setMessage] = useState(a.message);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(null); // 'dismiss'

  const call = async (path, body, ok) => {
    setBusy(true);
    try {
      await client.post(`/workbench/actions/${a.id}/${path}`, body || {});
      toast(ok, 'success');
      onChanged();
    } catch (err) {
      toast(errorText(err), 'error', 6000);
    } finally { setBusy(false); setAsking(null); }
  };

  const measured = a.outcome != null;
  return (
    <li className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm text-white font-medium">#{a.id} · {a.channelLabel}</span>
        <span className={`badge ${STATUS_STYLE[a.status] || 'bg-white/10 text-gray-300'}`}>{a.status}</span>
        {a.simulated && a.status !== 'recommended' && a.status !== 'dismissed' && <Provenance kind="simulated">Simulated delivery</Provenance>}
        {a.group === 'holdout' && <span className="badge bg-gray-500/20 text-gray-300" title="Deliberately not contacted so the effect can be measured">Holdout — do not contact</span>}
        {String(a.campaign).startsWith('scenario:') && <Provenance kind="simulated">Scenario</Provenance>}
      </div>

      {editing ? (
        <textarea className="input-field text-sm w-full" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Edit message" />
      ) : (
        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{a.message}</p>
      )}
      <div className="text-[11px] text-gray-500 mt-1">
        {fmt.ago(a.createdAt)}{a.approvedBy ? ` · approved by ${a.approvedBy}` : ''} · observation window ends {fmt.date(a.windowEnds)}
      </div>

      {a.status === 'recommended' && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button disabled={busy} onClick={() => setEditing((e) => !e)} className="btn-ghost px-3 py-1.5 text-xs">{editing ? 'Preview' : 'Edit message'}</button>
          <button disabled={busy || !message.trim()} onClick={() => call('approve', { message: editing || message !== a.message ? message : undefined }, 'Approved — a person has signed this off')}
            className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Check size={13} /> Approve</button>
          <button disabled={busy} onClick={() => setAsking('dismiss')} className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5"><Ban size={13} /> Dismiss</button>
        </div>
      )}
      {a.status === 'approved' && (
        <div className="mt-3">
          <button disabled={busy} onClick={() => call('execute', null, 'Recorded as a SIMULATED delivery — nothing was sent')} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5">
            <Send size={13} /> Record simulated delivery
          </button>
          <p className="text-[11px] text-gray-500 mt-1.5">No delivery integration is connected. This records the action; it does not message the customer.</p>
        </div>
      )}
      {(a.status === 'delivered' || a.status === 'executed') && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {measured ? (
            <span className="text-xs text-gray-300">Outcome: <b className="text-white">{fmt.label(a.outcome)}</b> {a.outcomeObserved === false ? <Provenance kind="simulated" /> : <Provenance kind="observed" />}</span>
          ) : <span className="text-xs text-gray-500">Outcome pending:</span>}
          {['retained', 'churned', 'no_response'].map((o) => (
            <button key={o} disabled={busy} onClick={() => call('outcome', { outcome: o }, `Outcome recorded: ${fmt.label(o)}`)} className="btn-chip border border-white/10 bg-white/[0.03] text-gray-300 hover:text-white">{fmt.label(o)}</button>
          ))}
        </div>
      )}

      {asking === 'dismiss' && (
        <div className="mt-3 flex gap-2">
          <input className="input-field text-sm py-1.5" placeholder="Reason (required)" aria-label="Dismissal reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <button disabled={busy || !reason.trim()} onClick={() => call('dismiss', { reason }, 'Recommendation dismissed')} className="btn-primary px-3 text-xs">Confirm</button>
        </div>
      )}
    </li>
  );
}

/** Ranked channel options + the customer's outreach actions, with the full approve → record → outcome flow. */
export default function ActionWorkbench({ customerId, alertId, compact = false, onChange }) {
  const toast = useToast();
  const options = useApi(`/workbench/options/${customerId}`);
  const actions = useApi('/workbench/actions');
  const [creating, setCreating] = useState(false);

  const reload = () => { options.reload(); actions.reload(); onChange?.(); };
  const mine = (actions.data?.actions || []).filter((a) => a.customerId === Number(customerId));
  const live = mine.some((a) => ['recommended', 'approved'].includes(a.status));

  const create = async (channel) => {
    setCreating(true);
    try {
      const r = await client.post('/workbench/recommend', { customer_id: Number(customerId), channel, alert_id: alertId });
      toast(r.data.holdout ? 'Customer is in the holdout group — recorded, no contact planned' : 'Recommendation drafted for review', 'success');
      reload();
    } catch (err) {
      toast(errorText(err), 'error', 7000);
    } finally { setCreating(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Channel options</h3>
        <Boundary state={options} rows={3}>
          {(o) => (
            <>
              <p className="text-[11px] text-gray-500 mb-2">{o.ranking} {o.consent.note}</p>
              <ul className="space-y-1.5">
                {o.options.slice(0, compact ? 3 : 5).map((opt) => (
                  <li key={opt.channel} className={`rounded-lg border px-3 py-2 ${opt.feasible ? 'border-white/10 bg-white/[0.02]' : 'border-white/[0.05] opacity-70'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm text-white">{opt.rank}. {opt.label}</span>
                        {opt.preferred && <span className="badge bg-gold/15 text-gold ml-2">Rule-selected</span>}
                        {!opt.feasible && <span className="badge bg-risk-critical/10 text-risk-critical ml-2">Blocked</span>}
                      </div>
                      <button disabled={creating || !opt.feasible || live} onClick={() => create(opt.channel)} className="btn-ghost px-2.5 py-1 text-xs flex items-center gap-1 shrink-0"
                        title={live ? 'An action is already awaiting review' : opt.feasible ? 'Draft a recommendation for review' : 'Blocked by safeguards'}>
                        <Megaphone size={12} /> Draft
                      </button>
                    </div>
                    {[...opt.reasons, ...opt.constraints.map((c) => c.text)].slice(0, 3).map((t) => <p key={t} className={`text-[11px] mt-1 ${opt.feasible ? 'text-gray-500' : 'text-risk-high'}`}>{t}</p>)}
                    {opt.observedEvidence && <p className="text-[11px] text-gray-600 mt-1">Observed here: {fmt.pct(opt.observedEvidence.retentionRate, 0)} retained of {opt.observedEvidence.measuredOutcomes} measured ({opt.observedEvidence.caveat})</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Boundary>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Actions for this customer</h3>
        <Boundary state={actions} rows={2} isEmpty={() => mine.length === 0} empty={<EmptyState title="No outreach actions yet">Draft one from the options above. Nothing is sent until a person approves it, and delivery is simulated in this demo.</EmptyState>}>
          {() => <ul className="space-y-2.5">{mine.map((a) => <ActionRow key={a.id} a={a} onChanged={reload} />)}</ul>}
        </Boundary>
      </div>
    </div>
  );
}
