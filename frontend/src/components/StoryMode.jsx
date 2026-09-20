import { ChevronLeft, ChevronRight, Pause, Play, Sparkles, Square } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const STEP_MS = 7000;

function waitFor(selector, timeout = 6000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return resolve(null);
      setTimeout(poll, 120);
    };
    poll();
  });
}

/** Builds the journey for whichever customer is currently top of the critical watchlist. */
async function buildSteps() {
  const stats = (await client.get('/customers/stats')).data;
  const hero = stats.watchlist[0];
  const ctx = { hero, riskBefore: hero.churnRiskScore, actionId: null, complaintId: null, riskAfter: null };

  return [
    {
      route: '/', target: '[data-tour="kpis"]',
      title: 'The bank, right now',
      text: () => `${stats.total.toLocaleString()} customers scored by a RandomForest trained on real churn labels. ${stats.byRiskLevel.critical.toLocaleString()} are critical — ₹${(stats.balanceAtRisk / 1e7).toFixed(1)}Cr of balances at risk.`,
    },
    {
      route: '/', target: '[data-tour="watchlist"]',
      title: `Meet ${hero.surname}`,
      text: () => `${hero.surname} at ${hero.branch} is our riskiest relationship at ${hero.churnRiskScore.toFixed(0)}%. Let's follow what the platform does about it.`,
    },
    {
      route: () => `/customers/${hero.customerId}`, target: '[data-tour="why-risk"]',
      title: 'Why the model thinks so',
      text: () => `Drivers are derived from the model's real feature importances — not hand-written rules. ${hero.churnDrivers[0] ? `Top signal: "${hero.churnDrivers[0]}".` : ''}`,
    },
    {
      route: () => `/customers/${hero.customerId}`, target: '[data-tour="simulator"]',
      title: 'What if we intervene?',
      text: () => 'The what-if simulator re-scores the customer live through the trained model. Every slider is a real feature — no fabricated uplift curves.',
    },
    {
      route: () => `/customers/${hero.customerId}`, target: '[data-tour="outreach-panel"]',
      title: 'Predictive outreach fires',
      action: async () => {
        const res = await client.post('/outreach/trigger', { customer_id: hero.customerId });
        ctx.actionId = res.data.action.id;
        ctx.channel = res.data.action.channelLabel;
        ctx.audit = res.data.audit?.status;
      },
      text: () => `Channel chosen from real signals: ${ctx.channel}. Action #${ctx.actionId} is persisted and its hash is on the blockchain (${ctx.audit}).`,
    },
    {
      route: '/complaints', target: '[data-tour="inbox"]',
      title: 'A complaint arrives',
      action: async () => {
        const res = await client.post('/complaints', {
          customer_id: hero.customerId, channel: 'whatsapp',
          subject: 'Unauthorized UPI debit',
          body: 'Rs 18,000 was debited via UPI last night without my approval. If this is not reversed I will go to the ombudsman.',
        });
        ctx.complaintId = res.data.complaint.id;
        ctx.severity = res.data.complaint.severity;
        ctx.related = res.data.related.length;
      },
      text: () => `${ctx.complaintId} auto-triaged as ${ctx.severity} (4h SLA) from the text alone; ${ctx.related} related case(s) detected via TF-IDF. Same customer — the 360 view links them.`,
    },
    {
      route: '/complaints', target: '[data-tour="inbox"]',
      title: 'Resolved, on the record',
      action: async () => {
        const res = await client.patch(`/complaints/${ctx.complaintId}/status`, { status: 'resolved', note: 'Refund processed under RBI zero-liability' });
        ctx.resolveAudit = res.data.audit?.status;
      },
      text: () => `Resolution is written to the audit chain automatically (${ctx.resolveAudit}). Regulators get a tamper-evident trail, not a spreadsheet.`,
    },
    {
      route: '/outreach', target: '[data-tour="outreach-log"]',
      title: 'The outcome comes back',
      action: async () => {
        await client.post(`/outreach/${ctx.actionId}/outcome`, { outcome: 'retained', notes: 'Story mode' });
        const res = await client.post('/outreach/retrain');
        ctx.feedbackRows = res.data.metrics.feedback_rows_used;
        const after = (await client.get(`/customers/${hero.customerId}`)).data;
        ctx.riskAfter = after.churnRiskScore;
      },
      text: () => `${hero.surname} stayed. That outcome is fed back and the model retrained on ${ctx.feedbackRows} labelled outcome(s) — the PS4 feedback loop, live.`,
    },
    {
      route: () => `/customers/${hero.customerId}`, target: '[data-tour="risk-badge"]',
      title: 'The model learned',
      text: () => `Risk moved from ${ctx.riskBefore.toFixed(1)}% to ${ctx.riskAfter?.toFixed(1)}% after the bank acted and reported back.`,
    },
    {
      route: '/blockchain', target: '[data-tour="chain-records"]',
      title: 'Every action, tamper-evident',
      text: () => 'Outreach, resolution and regulatory exports are all hashed on-chain from the server — private keys never leave the backend.',
    },
  ];
}

export default function StoryMode() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [steps, setSteps] = useState(null);
  const [idx, setIdx] = useState(-1);
  const [rect, setRect] = useState(null);
  const [text, setText] = useState('');
  const [playing, setPlaying] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef(null);
  const runId = useRef(0);

  const stop = useCallback(() => {
    clearInterval(timerRef.current);
    setIdx(-1); setSteps(null); setRect(null); setProgress(0);
  }, []);

  const runStep = useCallback(async (list, i) => {
    const step = list[i];
    if (!step) return stop();
    const myRun = ++runId.current;
    setBusy(true);
    setRect(null);
    clearInterval(timerRef.current);
    setProgress(0);
    try {
      const route = typeof step.route === 'function' ? step.route() : step.route;
      if (window.location.pathname !== route) navigate(route);
      if (step.action) await step.action();
      await new Promise((r) => setTimeout(r, 400));
      const el = await waitFor(step.target);
      if (myRun !== runId.current) return;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise((r) => setTimeout(r, 450));
        const r = el.getBoundingClientRect();
        setRect({ top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 });
      }
      setText(typeof step.text === 'function' ? step.text() : step.text);
    } finally {
      if (myRun === runId.current) setBusy(false);
    }
  }, [navigate, stop]);

  const start = async () => {
    const list = await buildSteps();
    setSteps(list);
    setPlaying(true);
    setIdx(0);
    runStep(list, 0);
  };

  const go = (delta) => {
    if (!steps) return;
    const next = idx + delta;
    if (next < 0 || next >= steps.length) return stop();
    setIdx(next);
    runStep(steps, next);
  };

  // Autoplay timer
  useEffect(() => {
    clearInterval(timerRef.current);
    if (idx < 0 || !playing || busy || !rect) return undefined;
    const started = Date.now();
    timerRef.current = setInterval(() => {
      const p = (Date.now() - started) / STEP_MS;
      setProgress(Math.min(1, p));
      if (p >= 1) { clearInterval(timerRef.current); go(1); }
    }, 100);
    return () => clearInterval(timerRef.current);
  }, [idx, playing, busy, rect]);

  // Re-measure on resize/scroll
  useEffect(() => {
    if (idx < 0 || !steps) return undefined;
    const rem = () => {
      const el = document.querySelector(steps[idx].target);
      if (el) { const r = el.getBoundingClientRect(); setRect({ top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 }); }
    };
    window.addEventListener('resize', rem);
    window.addEventListener('scroll', rem, true);
    return () => { window.removeEventListener('resize', rem); window.removeEventListener('scroll', rem, true); };
  }, [idx, steps]);

  if (!isAuthenticated) return null;

  if (idx < 0) {
    return (
      <button
        onClick={start}
        data-tour="story-button"
        className="fixed bottom-5 left-5 z-[90] btn-primary px-4 py-2.5 text-sm flex items-center gap-2 shadow-glow"
        title="Auto-narrated walkthrough of one customer's journey through the platform"
      >
        <Play size={14} /> Play story
      </button>
    );
  }

  const step = steps[idx];
  const captionBelow = rect ? rect.top + rect.height + 200 < window.innerHeight : true;

  return (
    <>
      <div className="fixed inset-0 z-[80] pointer-events-none">
        {rect ? (
          <div
            className="absolute rounded-xl border-2 border-gold/70 transition-all duration-500"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, boxShadow: '0 0 0 9999px rgba(3,8,20,0.72), 0 0 40px rgba(212,175,55,0.35)' }}
          />
        ) : (
          <div className="absolute inset-0 bg-[rgba(3,8,20,0.72)]" />
        )}
      </div>

      <div
        className="fixed z-[95] w-[440px] card shadow-glow p-5 fade-in"
        style={rect ? { left: Math.min(Math.max(16, rect.left), window.innerWidth - 456), top: captionBelow ? rect.top + rect.height + 14 : Math.max(16, rect.top - 190) } : { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-gold" />
          <span className="kicker">Story · step {idx + 1} of {steps.length}</span>
          {busy && <span className="ml-auto text-[11px] text-gray-500 animate-pulse">working…</span>}
        </div>
        <h3 className="text-white font-bold text-base mb-1">{step.title}</h3>
        <p className="text-sm text-gray-300 leading-relaxed min-h-[40px]">{busy ? 'Running the real action on the backend…' : text}</p>
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden mt-3">
          <div className="h-full bg-gold transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => go(-1)} disabled={idx === 0 || busy} className="btn-ghost p-2 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <button onClick={() => setPlaying((p) => !p)} className="btn-ghost p-2">{playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <button onClick={() => go(1)} disabled={busy} className="btn-primary px-3 py-2 text-xs flex items-center gap-1 disabled:opacity-40">
            {idx === steps.length - 1 ? 'Finish' : 'Next'} <ChevronRight size={13} />
          </button>
          <button onClick={stop} className="ml-auto btn-ghost p-2 text-gray-400" title="Stop"><Square size={13} /></button>
        </div>
      </div>
    </>
  );
}
