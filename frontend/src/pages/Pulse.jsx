import { Activity, AlertTriangle, Gauge, ShieldAlert, TrendingDown, Users, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { client } from '../api/client';
import { RiskBadge, Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';

const RISK_FILTERS = [
  { value: '', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function Pulse() {
  const [customers, setCustomers] = useState([]);
  const [riskLevel, setRiskLevel] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    setLoading(true);
    client
      .get('/customers', { params: riskLevel ? { riskLevel } : {} })
      .then((res) => setCustomers(res.data.customers))
      .finally(() => setLoading(false));
  }, [riskLevel]);

  useEffect(() => {
    client.get('/customers/model/metrics').then((res) => setMetrics(res.data));
  }, []);

  const stats = useMemo(() => {
    if (!customers.length) return null;
    const critical = customers.filter((c) => c.churnRiskLevel === 'critical').length;
    const avgRisk = customers.reduce((s, c) => s + c.churnRiskScore, 0) / customers.length;
    const atRiskBalance = customers
      .filter((c) => ['critical', 'high'].includes(c.churnRiskLevel))
      .reduce((s, c) => s + c.balance, 0);
    return { critical, avgRisk, atRiskBalance, total: customers.length };
  }, [customers]);

  return (
    <div>
      <PageHeader
        icon={Activity}
        title="Churn Pulse"
        subtitle="Live risk scoring from a RandomForestClassifier trained on the bank-churn dataset — not a hardcoded heuristic."
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Customers shown" value={stats ? stats.total : '—'} icon={Users} tone="gold" />
        <StatCard label="Critical risk" value={stats ? stats.critical : '—'} icon={ShieldAlert} tone="red" />
        <StatCard label="Avg. risk score" value={stats ? `${stats.avgRisk.toFixed(1)}%` : '—'} icon={Gauge} tone="blue" />
        <StatCard
          label="Balance at risk"
          value={stats ? `₹${(stats.atRiskBalance / 100000).toFixed(1)}L` : '—'}
          sub="critical + high risk"
          icon={TrendingDown}
          tone="red"
        />
      </div>

      {metrics && (
        <Card title="Model performance" className="mb-6">
          <div className="flex gap-10">
            <div>
              <div className="text-2xl font-bold text-gold tabular-nums">{metrics.metrics.auc.toFixed(3)}</div>
              <div className="text-xs text-gray-500 mt-0.5">AUC (real held-out test set)</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white tabular-nums">{(metrics.metrics.accuracy * 100).toFixed(1)}%</div>
              <div className="text-xs text-gray-500 mt-0.5">Accuracy</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white tabular-nums">{metrics.metrics.n_train}<span className="text-gray-500 text-base"> / {metrics.metrics.n_test}</span></div>
              <div className="text-xs text-gray-500 mt-0.5">Train / test split</div>
            </div>
          </div>
        </Card>
      )}

      <div className="flex gap-2 mb-4">
        {RISK_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setRiskLevel(f.value)}
            className={`btn-chip ${riskLevel === f.value ? 'bg-gold text-navy-dark' : 'bg-white/[0.04] text-gray-400 hover:text-gray-200 hover:bg-white/[0.08]'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card title={`Customers (${customers.length})`} noPad>
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-10" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-modern">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Branch</th>
                  <th>Segment</th>
                  <th>Risk</th>
                  <th>Balance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.customerId}>
                    <td>
                      <div className="text-white font-medium">{c.surname}</div>
                      <div className="text-gray-500 text-xs font-mono">{c.accountNo}</div>
                    </td>
                    <td className="text-gray-400">{c.branch}</td>
                    <td className="text-gray-400 capitalize">{c.segment.replace('_', ' ')}</td>
                    <td>
                      <RiskBadge level={c.churnRiskLevel}>{c.churnRiskScore.toFixed(0)}% {c.churnRiskLevel}</RiskBadge>
                    </td>
                    <td className="text-gray-300 tabular-nums">₹{c.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td>
                      <button className="text-gold text-xs font-medium hover:underline" onClick={() => setSelected(c)}>
                        Details →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 fade-in"
          onClick={() => setSelected(null)}
        >
          <div className="card p-6 w-[460px] shadow-glow" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-white font-bold text-lg">{selected.surname}</h2>
                <p className="text-gray-500 text-xs font-mono">{selected.accountNo} &middot; {selected.branch}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <RiskBadge level={selected.churnRiskLevel}>{selected.churnRiskScore.toFixed(1)}% {selected.churnRiskLevel}</RiskBadge>
              <span className="text-gray-500 text-xs">&middot;</span>
              <span className="text-gray-400 text-xs capitalize">{selected.segment.replace('_', ' ')}</span>
            </div>

            <div className="rounded-lg bg-gold/[0.06] border border-gold/10 px-3 py-2.5 mb-4">
              <div className="text-[11px] text-gold/70 uppercase tracking-wide font-semibold mb-0.5">Recommended action</div>
              <div className="text-sm text-white">{selected.recommendedAction}</div>
            </div>

            <div className="text-gray-400 text-xs mb-1.5">Products</div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {selected.products.map((p) => (
                <span key={p} className="px-2 py-1 rounded-md bg-white/[0.05] text-gray-300 text-xs capitalize">{p.replace('_', ' ')}</span>
              ))}
            </div>

            <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-2">
              <AlertTriangle size={13} /> Risk drivers
            </div>
            <ul className="space-y-1.5">
              {selected.churnDrivers.map((d, i) => (
                <li key={i} className="text-sm text-gray-300 flex gap-2">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-risk-high shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
