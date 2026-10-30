import { FlaskConical, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { client } from '../api/client';
import ActionWorkbench from '../components/ActionWorkbench';
import CustomerTimeline from '../components/CustomerTimeline';
import PageHeader from '../components/PageHeader';
import { useToast } from '../components/Toast';
import {
  Chip, EmptyState, fmt, Provenance, Section, SeverityBadge,
} from '../components/ui';
import { errorText, useApi } from '../lib/useApi';

const KEY = 'bank_pulse_scenario_run';

function ScoreLine({ scores }) {
  if (!scores.length) return <p className="text-xs text-gray-500">No scores recorded yet.</p>;
  const W = 420; const H = 110; const P = 22;
  const lo = Math.min(...scores.map((s) => s.score)) - 3; const hi = Math.max(...scores.map((s) => s.score)) + 3;
  const x = (i) => P + (scores.length === 1 ? 0.5 : i / (scores.length - 1)) * (W - 2 * P);
  const y = (v) => H - 16 - ((v - lo) / (hi - lo)) * (H - 32);
  const d = scores.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.score)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Risk score by step: ${scores.map((s) => s.score.toFixed(0)).join(', ')}`}>
      {[50, 70].filter((t) => t > lo && t < hi).map((t) => <g key={t}><line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" /><text x={W - P} y={y(t) - 3} textAnchor="end" fontSize="9" fill="#8b93a7">{t === 70 ? 'critical ≥70' : 'high ≥50'}</text></g>)}
      <path d={d} fill="none" stroke="#d4af37" strokeWidth="2" />
      {scores.map((s, i) => <g key={s.at}><circle cx={x(i)} cy={y(s.score)} r="4" fill="#d4af37" stroke="#0a1428" strokeWidth="1.5" /><text x={x(i)} y={y(s.score) - 8} textAnchor="middle" fontSize="10" fill="#e7eaf2">{s.score.toFixed(0)}</text></g>)}
    </svg>
  );
}

function FeatureDiff({ before, after }) {
  if (!after) return null;
  const rows = [
    ['Days since last activity', (f) => f.days_since_last_activity],
    ['Logins, last 30d', (f) => f.windows['30d'].logins],
    ['Transactions, last 30d', (f) => f.windows['30d'].transactions],
    ['Balance', (f) => (f.balance_now == null ? null : fmt.inr(f.balance_now))],
    ['Balance change, 30d', (f) => (f.balance_change_pct_30d == null ? null : `${f.balance_change_pct_30d}%`)],
    ['Unresolved complaints', (f) => f.unresolved_complaints],
    ['History sufficiency', (f) => f.sufficiency.replace('_', ' ')],
  ];
  return (
    <table className="table-modern text-xs">
      <thead><tr><th>Feature</th><th className="text-right">Before</th><th className="text-right">After</th></tr></thead>
      <tbody>
        {rows.map(([label, fn]) => {
          const b = before ? fn(before) : null; const a = fn(after);
          return <tr key={label}><td className="text-gray-400">{label}</td><td className="text-right tabular-nums text-gray-500">{b ?? '—'}</td><td className={`text-right tabular-nums ${b !== a ? 'text-gold font-medium' : 'text-gray-300'}`}>{a ?? '—'}</td></tr>;
        })}
      </tbody>
    </table>
  );
}

export default function ScenarioStudio() {
  const toast = useToast();
  const scenarios = useApi('/scenarios');
  const [run, setRun] = useState(null);
  const [seed, setSeed] = useState(7);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const timer = useRef(null);

  const refresh = useCallback(async (id) => {
    const r = await client.get(`/scenarios/runs/${id}`);
    setRun(r.data); setVersion((v) => v + 1); return r.data;
  }, []);

  useEffect(() => {
    const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    if (saved) refresh(saved).catch(() => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } });
  }, [refresh]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await client.post('/scenarios/runs', { scenario: scenarios.data.scenarios[0].id, seed: Number(seed) });
      setRun(r.data); try { localStorage.setItem(KEY, r.data.runId); } catch { /* ignore */ }
      toast('Scenario ready — all data it creates is labelled simulated', 'success');
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };

  const step = useCallback(async () => {
    if (!run || busy) return;
    setBusy(true);
    try {
      const r = await client.post(`/scenarios/runs/${run.runId}/step`);
      const fresh = await refresh(run.runId);
      if (r.data.alertId) toast(`Alert ${r.data.alertId} raised: ${r.data.triggers[0]?.text}`, 'info', 6000);
      if (fresh.complete) setPlaying(false);
    } catch (err) { setPlaying(false); toast(errorText(err), 'error'); } finally { setBusy(false); }
  }, [run, busy, refresh, toast]);

  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setTimeout(step, 2600 / speed);
    return () => clearTimeout(timer.current);
  }, [playing, speed, step, run?.step]);

  const reset = async () => {
    if (!run) return;
    setPlaying(false); setBusy(true);
    try {
      const r = await client.delete(`/scenarios/runs/${run.runId}`);
      const n = r.data.removed;
      toast(`Reset: removed ${n.events} events, ${n.alerts} alert(s), ${n.outreach} outreach record(s) from this scenario only`, 'success', 6000);
      setRun(null); try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };

  const meta = scenarios.data?.scenarios?.[0];
  const alert = run?.alerts?.[0];
  const doneSteps = run?.steps.filter((s) => s.done) || [];

  return (
    <div>
      <PageHeader icon={FlaskConical} title="Scenario Studio" crumbs={[{ label: 'Retention', to: '/' }, { label: 'Scenario Studio' }]}
        subtitle="A reproducible, clearly-simulated customer journey that exercises the real pipeline: events → features → model score → alert → recommendation → approval → outcome."
        action={<Provenance kind="simulated">Everything here is simulated</Provenance>} />

      {!run ? (
        <Section title={meta?.name || 'Scenario'} hint={meta?.description}>
          {!meta ? <EmptyState title="Loading scenarios…" /> : (
            <div className="space-y-4">
              <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {meta.steps.map((s, i) => <li key={s.label} className="card p-3"><div className="text-[11px] text-gold font-semibold">STEP {i + 1} · day {s.day}</div><div className="text-sm text-white mt-0.5">{s.label}</div><p className="text-xs text-gray-500 mt-1">{s.detail}</p></li>)}
              </ol>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-gray-400">Seed
                  <input type="number" min="0" max="10000" value={seed} onChange={(e) => setSeed(e.target.value)} className="input-field w-28 py-1.5 mt-1 block" />
                </label>
                <button disabled={busy} onClick={start} className="btn-primary px-4 py-2 text-sm">Create run</button>
                <p className="text-xs text-gray-500 max-w-md">The same seed on the same data picks the same customer and generates identical events. A customer with no stored override is chosen; their real record is never edited.</p>
              </div>
            </div>
          )}
        </Section>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Section title="Playback" className="xl:col-span-12">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => setPlaying((p) => !p)} disabled={busy || run.complete} className="btn-primary px-3.5 py-2 text-sm flex items-center gap-2">
                {playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
              </button>
              <button onClick={step} disabled={busy || run.complete || playing} className="btn-ghost px-3 py-2 text-sm flex items-center gap-2"><SkipForward size={14} /> Step</button>
              <button onClick={reset} disabled={busy} className="btn-ghost px-3 py-2 text-sm flex items-center gap-2"><RotateCcw size={14} /> Reset scenario</button>
              <div className="flex items-center gap-1.5 ml-auto" role="group" aria-label="Playback speed">
                {[0.5, 1, 2, 4].map((s) => <Chip key={s} active={speed === s} onClick={() => setSpeed(s)}>{s}×</Chip>)}
              </div>
            </div>
            <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              {run.steps.map((s) => (
                <li key={s.index} className={`rounded-lg border p-3 ${s.done ? 'border-gold/40 bg-gold/[0.06]' : s.index === run.step + 1 ? 'border-white/20' : 'border-white/[0.06] opacity-60'}`} aria-current={s.index === run.step + 1 ? 'step' : undefined}>
                  <div className="text-[11px] font-semibold text-gold">STEP {s.index} · day {s.day}{s.done ? ' ✓' : ''}</div>
                  <div className="text-sm text-white">{s.label}</div>
                  <p className="text-xs text-gray-500 mt-1">{s.detail}</p>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Customer under watch" className="xl:col-span-4" hint={`${run.surname} · ${run.branch} · CUST-${run.customerId}`}>
            <div className="flex items-end justify-between mb-2">
              <div><div className="text-[11px] text-gray-500">Current risk score</div><div className="text-3xl font-bold tabular-nums text-white">{run.currentScore.toFixed(0)}</div></div>
              <SeverityBadge level={run.currentLevel} />
            </div>
            <ScoreLine scores={run.scores} />
            <p className="text-[11px] text-gray-500 mt-2">The model reads two event-derived fields — activity status and balance — through the documented overlay; everything else is the customer’s dataset record. Higher balances raise churn risk in this dataset, so a balance drop alone can lower the score; inactivity raises it.</p>
            <div className="flex flex-wrap gap-3 mt-3 text-xs">
              <Link to={`/customers/${run.customerId}`} className="text-gold hover:underline">Open customer profile</Link>
              {alert && <Link to={`/alerts?open=${alert.id}`} className="text-gold hover:underline">Open alert {alert.id}</Link>}
            </div>
          </Section>

          <Section title="Before / after features" className="xl:col-span-4" hint={doneSteps.length ? `After step ${doneSteps.length}: ${doneSteps[doneSteps.length - 1].label}` : 'Advance a step to compute features'}>
            {doneSteps.length === 0 ? <EmptyState title="No features yet">Press Step or Play. Features are computed from the events only — not from the dataset.</EmptyState>
              : <FeatureDiff before={doneSteps.length > 1 ? doneSteps[doneSteps.length - 2].features : null} after={doneSteps[doneSteps.length - 1].features} />}
          </Section>

          <Section title="Generated events" className="xl:col-span-4" hint={`${run.eventCount} simulated events in this run`}>
            {run.events.length === 0 ? <EmptyState title="No events yet" /> : (
              <ul className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                {run.events.slice().reverse().map((e) => (
                  <li key={e.id} className="text-xs flex justify-between gap-2"><span className="text-gray-300">{fmt.label(e.type)}{e.amount ? ` ${fmt.inr(Math.abs(e.amount))}` : ''}</span><span className="text-gray-600 tabular-nums">{fmt.date(e.at)}</span></li>
                ))}
              </ul>
            )}
          </Section>

          {alert && (
            <>
              <Section title="Alert and intervention" className="xl:col-span-7" hint={`${alert.id} · ${fmt.label(alert.status)} — try different channels; every outcome here is labelled simulated.`}>
                <ActionWorkbench customerId={run.customerId} alertId={alert.id} onChange={() => setVersion((v) => v + 1)} />
              </Section>
              <Section title="Unified timeline" className="xl:col-span-5"><CustomerTimeline customerId={run.customerId} version={version} /></Section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
