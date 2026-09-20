import { ArrowRight, FlaskConical, RotateCcw } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import { RiskBadge } from './Badge';
import { useDebounce } from '../lib/hooks';

const RISK_COLORS = { critical: '#f43f5e', high: '#f59e0b', medium: '#38bdf8', low: '#34d399' };

function Toggle({ label, value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(value ? 0 : 1)}
      className="flex items-center justify-between w-full text-sm py-1.5"
    >
      <span className="text-gray-300">{label}</span>
      <span className={`w-9 h-5 rounded-full relative transition-colors ${value ? 'bg-gold' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function Slider({ label, value, min, max, step, format, onChange }) {
  return (
    <div className="py-1.5">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-300">{label}</span>
        <span className="text-white tabular-nums">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#d4af37]" />
    </div>
  );
}

export default function WhatIfSimulator({ customerId, baseline }) {
  const [state, setState] = useState(null);
  const [result, setResult] = useState(null);
  const debounced = useDebounce(state, 250);

  useEffect(() => {
    if (baseline) {
      setState({
        is_active_member: baseline.isActiveMember ? 1 : 0,
        num_products: baseline.products.length,
        balance: baseline.balance,
        credit_score: baseline.creditScore,
        complaint_count: baseline.complaintCount ?? 0,
      });
    }
  }, [baseline]);

  useEffect(() => {
    if (!debounced) return;
    client.post(`/customers/${customerId}/simulate`, debounced).then((res) => setResult(res.data));
  }, [debounced, customerId]);

  if (!state) return null;

  const reset = () => setState({
    is_active_member: baseline.isActiveMember ? 1 : 0,
    num_products: baseline.products.length,
    balance: baseline.balance,
    credit_score: baseline.creditScore,
    complaint_count: baseline.complaintCount ?? 0,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <FlaskConical size={13} className="text-gold" /> Re-scored live by the trained model
        </div>
        <button onClick={reset} className="text-xs text-gray-500 hover:text-gold flex items-center gap-1"><RotateCcw size={11} /> Reset</button>
      </div>

      {result && (
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 flex items-center justify-between">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Now</div>
            <div className="text-xl font-bold tabular-nums" style={{ color: RISK_COLORS[result.baselineLevel] }}>{result.baselineRisk}%</div>
          </div>
          <ArrowRight size={18} className="text-gray-600" />
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">If applied</div>
            <div className="text-xl font-bold tabular-nums" style={{ color: RISK_COLORS[result.simulatedLevel] }}>{result.simulatedRisk}%</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Change</div>
            <div className={`text-xl font-bold tabular-nums ${result.delta < 0 ? 'text-risk-low' : result.delta > 0 ? 'text-risk-critical' : 'text-gray-400'}`}>
              {result.delta > 0 ? '+' : ''}{result.delta}
            </div>
          </div>
        </div>
      )}

      <Toggle label="Re-activate digital banking" value={state.is_active_member} onChange={(v) => setState({ ...state, is_active_member: v })} />
      <Slider label="Products held" value={state.num_products} min={1} max={4} step={1} format={(v) => v} onChange={(v) => setState({ ...state, num_products: v })} />
      <Slider label="Balance" value={state.balance} min={0} max={Math.max(250000, baseline.balance * 2)} step={5000} format={(v) => `₹${Math.round(v).toLocaleString('en-IN')}`} onChange={(v) => setState({ ...state, balance: v })} />
      <Slider label="Credit score" value={state.credit_score} min={350} max={850} step={5} format={(v) => v} onChange={(v) => setState({ ...state, credit_score: v })} />
      <Slider label="Open complaints resolved" value={state.complaint_count} min={0} max={Math.max(3, baseline.complaintCount ?? 0)} step={1} format={(v) => `${v} on file`} onChange={(v) => setState({ ...state, complaint_count: v })} />

      {result && result.simulatedLevel !== result.baselineLevel && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          Would move from <RiskBadge level={result.baselineLevel}>{result.baselineLevel}</RiskBadge> to <RiskBadge level={result.simulatedLevel}>{result.simulatedLevel}</RiskBadge>
        </div>
      )}
    </div>
  );
}
