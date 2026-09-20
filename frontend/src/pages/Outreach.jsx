import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js';
import { BrainCircuit, CheckCircle2, Megaphone, Send, TrendingUp, XCircle } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Link } from 'react-router-dom';
import { client } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { baseGridOptions, chartColors } from '../lib/chartTheme';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const OUTCOME_STYLES = {
  retained: 'bg-risk-low/15 text-risk-low',
  churned: 'bg-risk-critical/15 text-risk-critical',
  no_response: 'bg-gray-500/15 text-gray-400',
};

export default function Outreach() {
  const { role } = useAuth();
  const [actions, setActions] = useState(null);
  const [eff, setEff] = useState(null);
  const [busy, setBusy] = useState(null);
  const [retrain, setRetrain] = useState(null);

  const load = () => {
    client.get('/outreach/actions').then((res) => setActions(res.data.actions));
    client.get('/outreach/effectiveness').then((res) => setEff(res.data));
  };
  useEffect(() => { load(); }, []);

  const setOutcome = async (id, outcome) => {
    setBusy(`${id}-${outcome}`);
    try {
      await client.post(`/outreach/${id}/outcome`, { outcome });
      load();
    } finally {
      setBusy(null);
    }
  };

  const doRetrain = async () => {
    setBusy('retrain');
    try {
      const res = await client.post('/outreach/retrain');
      setRetrain(res.data.metrics);
      load();
    } finally {
      setBusy(null);
    }
  };

  const channels = eff ? Object.entries(eff.by_channel) : [];
  const chart = {
    labels: channels.map(([, v]) => v.label),
    datasets: [
      { label: 'Retained', data: channels.map(([, v]) => v.retained), backgroundColor: chartColors.green, borderRadius: 4, maxBarThickness: 40 },
      { label: 'Churned', data: channels.map(([, v]) => v.churned), backgroundColor: chartColors.red, borderRadius: 4, maxBarThickness: 40 },
      { label: 'No response', data: channels.map(([, v]) => v.no_response), backgroundColor: '#64748b', borderRadius: 4, maxBarThickness: 40 },
      { label: 'Pending', data: channels.map(([, v]) => v.pending), backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 4, maxBarThickness: 40 },
    ],
  };

  return (
    <div>
      <PageHeader
        icon={Megaphone}
        title="Predictive Outreach"
        subtitle="Every action is channel-routed from real signals, hashed on-chain, and its outcome feeds back into the churn model."
        action={
          role === 'admin' && (
            <button onClick={doRetrain} disabled={!!busy} className="btn-primary px-4 py-2 text-sm flex items-center gap-1.5">
              {busy === 'retrain' ? <Spinner size={13} className="text-navy-dark" /> : <BrainCircuit size={14} />}
              Retrain with feedback
            </button>
          )
        }
      />

      {retrain && (
        <div className="fade-in mb-4 rounded-lg bg-risk-low/[0.06] border border-risk-low/20 px-4 py-3 text-sm text-gray-200 flex items-center gap-3">
          <BrainCircuit size={16} className="text-risk-low" />
          Model retrained with <span className="text-gold font-semibold">{retrain.feedback_rows_used}</span> outcome-labelled customer(s) ·
          AUC {retrain.auc.toFixed(3)} · accuracy {(retrain.accuracy * 100).toFixed(1)}% · {new Date(retrain.trained_at).toLocaleTimeString()}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Outreach sent" value={eff ? eff.total.sent : '—'} icon={Send} tone="gold" />
        <StatCard label="Retained" value={eff ? eff.total.retained : '—'} icon={CheckCircle2} tone="green" />
        <StatCard label="Churned" value={eff ? eff.total.churned : '—'} icon={XCircle} tone="red" />
        <StatCard
          label="Retention rate"
          value={eff && eff.total.retention_rate != null ? `${(eff.total.retention_rate * 100).toFixed(0)}%` : '—'}
          sub={eff ? `${eff.total.pending} pending outcome` : undefined}
          icon={TrendingUp}
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card title="Outcomes by channel" className="col-span-2">
          {!eff || channels.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No outreach yet — trigger one from a customer's 360 view or the Churn Pulse.</p>
          ) : (
            <div className="h-56">
              <Bar data={chart} options={baseGridOptions({ scales: { x: { stacked: true, grid: { color: chartColors.grid }, ticks: { color: chartColors.text } }, y: { stacked: true, grid: { color: chartColors.grid }, ticks: { color: chartColors.text, precision: 0 } } } })} />
            </div>
          )}
        </Card>
        <Card title="Retention by segment">
          {!eff || Object.keys(eff.by_segment).length === 0 ? (
            <p className="text-sm text-gray-500">—</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(eff.by_segment).map(([seg, v]) => (
                <div key={seg} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300 capitalize">{seg.replace('_', ' ')}</span>
                  <span className="text-white tabular-nums">{v.retention_rate != null ? `${(v.retention_rate * 100).toFixed(0)}%` : '—'} <span className="text-gray-500 text-xs">/ {v.sent}</span></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title={`Outreach log (${actions?.length ?? 0})`} noPad>
        {!actions ? (
          <div className="p-5 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-10" />)}</div>
        ) : actions.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No outreach actions logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-modern">
              <thead><tr><th>#</th><th>Customer</th><th>Channel</th><th>Risk at trigger</th><th>Audit</th><th>Outcome</th><th>When</th></tr></thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id}>
                    <td className="text-gray-500">{a.id}</td>
                    <td><Link to={`/customers/${a.customerId}`} className="text-white hover:text-gold">{a.surname || a.customerId}</Link></td>
                    <td className="text-gray-300">{a.channelLabel}</td>
                    <td className="tabular-nums text-gray-300">{a.riskScoreAtTrigger.toFixed(0)}%</td>
                    <td><span className={`badge ${a.auditStatus === 'stored' ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>{a.auditStatus || 'n/a'}</span></td>
                    <td>
                      {a.outcome ? (
                        <span className={`badge ${OUTCOME_STYLES[a.outcome]}`}>{a.outcome.replace('_', ' ')}</span>
                      ) : (
                        <div className="flex gap-1">
                          {['retained', 'churned', 'no_response'].map((o) => (
                            <button key={o} onClick={() => setOutcome(a.id, o)} disabled={!!busy} className={`btn-chip text-[11px] ${OUTCOME_STYLES[o]} hover:brightness-125`}>
                              {busy === `${a.id}-${o}` ? '…' : o.replace('_', ' ')}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-gray-500 text-xs whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
