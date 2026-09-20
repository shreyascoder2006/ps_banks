import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js';
import { Activity, AlertTriangle, ArrowUpDown, ChevronLeft, ChevronRight, Gauge, Search, ShieldAlert, TrendingDown, Users, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Link, useSearchParams } from 'react-router-dom';
import { client } from '../api/client';
import { RiskBadge } from '../components/Badge';
import Card from '../components/Card';
import OutreachPanel from '../components/OutreachPanel';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { chartColors } from '../lib/chartTheme';
import { useDebounce } from '../lib/hooks';
import { useEvent } from '../lib/realtime';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const RISK_FILTERS = [
  { value: '', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const FEATURE_LABELS = {
  CreditScore: 'Credit score',
  Age: 'Age',
  Tenure: 'Tenure',
  Balance: 'Balance',
  'Num Of Products': 'Products held',
  'Has Credit Card': 'Has credit card',
  'Is Active Member': 'Active member',
  'Estimated Salary': 'Estimated salary',
  Geography_enc: 'Geography',
  Gender_enc: 'Gender',
};

export default function Pulse() {
  const [customers, setCustomers] = useState([]);
  const [riskLevel, setRiskLevel] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState('');
  const [searchParams] = useSearchParams();
  const [branch, setBranch] = useState(searchParams.get('branch') || '');
  const [branches, setBranches] = useState([]);
  const [sort, setSort] = useState({ key: 'risk', order: 'desc' });
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const debouncedQ = useDebounce(q, 250);
  const PAGE = 25;

  useEffect(() => { setPage(0); }, [riskLevel, debouncedQ, branch, sort]);

  useEffect(() => {
    setLoading(true);
    client
      .get('/customers', {
        params: {
          ...(riskLevel ? { riskLevel } : {}),
          ...(debouncedQ ? { q: debouncedQ } : {}),
          ...(branch ? { branch } : {}),
          sort: sort.key, order: sort.order, limit: PAGE, offset: page * PAGE,
        },
      })
      .then((res) => { setCustomers(res.data.customers); setTotal(res.data.total); })
      .finally(() => setLoading(false));
  }, [riskLevel, debouncedQ, branch, sort, page]);

  useEffect(() => {
    client.get('/customers/branches').then((res) => setBranches(res.data.branches));
  }, []);

  const [tick, setTick] = useState(0);
  useEvent(['risk_changed', 'balance_moved', 'model_retrained', 'outreach_triggered'], () => setTick((t) => t + 1));
  useEffect(() => {
    if (tick === 0) return;
    client.get('/customers', { params: { ...(riskLevel ? { riskLevel } : {}), ...(debouncedQ ? { q: debouncedQ } : {}), ...(branch ? { branch } : {}), sort: sort.key, order: sort.order, limit: PAGE, offset: page * PAGE } })
      .then((res) => { setCustomers(res.data.customers); setTotal(res.data.total); });
  }, [tick]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, order: s.order === 'desc' ? 'asc' : 'desc' } : { key, order: 'desc' }));

  const SortTh = ({ k, children }) => (
    <th className="cursor-pointer select-none hover:text-gray-300" onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sort.key === k && <ArrowUpDown size={11} className="text-gold" />}
      </span>
    </th>
  );

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

  const importanceChart = useMemo(() => {
    if (!metrics) return null;
    const entries = Object.entries(metrics.feature_importances).sort((a, b) => b[1] - a[1]);
    return {
      labels: entries.map(([k]) => FEATURE_LABELS[k] || k),
      datasets: [{
        data: entries.map(([, v]) => Math.round(v * 1000) / 10),
        backgroundColor: chartColors.gold,
        borderRadius: 4,
        barThickness: 14,
      }],
    };
  }, [metrics]);

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
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="flex gap-10 mb-5">
                <div>
                  <div className="text-2xl font-bold text-gold tabular-nums">{metrics.metrics.auc.toFixed(3)}</div>
                  <div className="text-xs text-gray-500 mt-0.5">AUC (real held-out test set)</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white tabular-nums">{(metrics.metrics.accuracy * 100).toFixed(1)}%</div>
                  <div className="text-xs text-gray-500 mt-0.5">Accuracy</div>
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white tabular-nums">{metrics.metrics.n_train}<span className="text-gray-500 text-base"> / {metrics.metrics.n_test}</span></div>
                <div className="text-xs text-gray-500 mt-0.5">Train / test split (RandomForestClassifier)</div>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Feature importance</div>
              <div style={{ height: `${importanceChart.labels.length * 22}px` }}>
                <Bar
                  data={importanceChart}
                  options={{
                    indexAxis: 'y',
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        backgroundColor: '#111f3d', borderColor: 'rgba(212,175,55,0.2)', borderWidth: 1,
                        titleColor: '#fff', bodyColor: '#c3c9d6', padding: 8, cornerRadius: 6,
                        callbacks: { label: (ctx) => `${ctx.raw}% of model decision weight` },
                      },
                    },
                    scales: {
                      x: { display: false },
                      y: { grid: { display: false }, border: { display: false }, ticks: { color: chartColors.text, font: { size: 11 } } },
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {RISK_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setRiskLevel(f.value)}
            className={`btn-chip ${riskLevel === f.value ? 'bg-gold text-navy-dark' : 'bg-white/[0.04] text-gray-400 hover:text-gray-200 hover:bg-white/[0.08]'}`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select className="input-field py-1.5 text-xs w-44" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.branch} value={b.branch}>{b.branch} · {b.critical} critical</option>)}
          </select>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input className="input-field pl-8 py-1.5 text-xs w-56" placeholder="Search surname, account, ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      <Card
        title={`Customers (${total.toLocaleString()})`}
        noPad
        action={
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}</span>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn-ghost p-1 disabled:opacity-30"><ChevronLeft size={13} /></button>
            <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)} className="btn-ghost p-1 disabled:opacity-30"><ChevronRight size={13} /></button>
          </div>
        }
      >
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-10" />)}
          </div>
        ) : customers.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 text-center">No customers match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-modern">
              <thead>
                <tr>
                  <SortTh k="surname">Customer</SortTh>
                  <th>Branch</th>
                  <th>Segment</th>
                  <SortTh k="risk">Risk</SortTh>
                  <SortTh k="balance">Balance</SortTh>
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
                    <td className="whitespace-nowrap">
                      <button className="text-gold text-xs font-medium hover:underline mr-3" onClick={() => setSelected(c)}>
                        Quick view
                      </button>
                      <Link to={`/customers/${c.customerId}`} className="text-gray-400 text-xs hover:text-gold">360 →</Link>
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
          <div className="card p-6 w-[480px] max-h-[90vh] overflow-y-auto shadow-glow" onClick={(e) => e.stopPropagation()}>
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
            <ul className="space-y-1.5 mb-4">
              {selected.churnDrivers.map((d, i) => (
                <li key={i} className="text-sm text-gray-300 flex gap-2">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-risk-high shrink-0" />
                  {d}
                </li>
              ))}
            </ul>

            <div className="border-t border-white/[0.06] pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="kicker">Predictive outreach</span>
                <Link to={`/customers/${selected.customerId}`} className="text-xs text-gray-400 hover:text-gold">Full 360 →</Link>
              </div>
              <OutreachPanel customerId={selected.customerId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
