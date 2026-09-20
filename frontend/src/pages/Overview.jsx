import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import {
  Activity, ArrowRight, CheckCircle2, Inbox, LayoutDashboard, Megaphone, RefreshCw, ShieldAlert, Sparkles, TrendingUp, Users, Wallet,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useInterval } from '../lib/hooks';
import { useEvent } from '../lib/realtime';
import { Doughnut } from 'react-chartjs-2';
import { Link } from 'react-router-dom';
import { client } from '../api/client';
import { RiskBadge } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { chartColors } from '../lib/chartTheme';

ChartJS.register(ArcElement, Tooltip, Legend);

const RISK_ORDER = ['critical', 'high', 'medium', 'low'];
const LIVE_TYPES = ['complaint_logged', 'complaint_status', 'complaint_message', 'outreach_triggered', 'outreach_outcome', 'risk_changed', 'balance_moved', 'model_retrained', 'audit_stored'];
const RISK_COLORS = { critical: chartColors.red, high: '#f59e0b', medium: chartColors.blue, low: chartColors.green };

export default function Overview() {
  const [stats, setStats] = useState(null);
  const [sentiment, setSentiment] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [complaints, setComplaints] = useState(null);
  const [activity, setActivity] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadLive = () => {
    client.get('/customers/stats').then((res) => setStats(res.data));
    client.get('/complaints').then((res) => setComplaints(res.data.complaints));
    client.get('/activity', { params: { limit: 12 } }).then((res) => { setActivity(res.data.events); setLastRefresh(new Date()); });
  };

  useEffect(() => {
    loadLive();
    client.get('/sentiment/market').then((res) => setSentiment(res.data));
    client.get('/forecast/growth', { params: { periods: 1 } }).then((res) => setForecast(res.data));
  }, []);
  useInterval(loadLive, 30000);
  useEvent(LIVE_TYPES, loadLive);

  const riskCounts = stats ? RISK_ORDER.map((level) => stats.byRiskLevel[level]) : null;
  const totalBalance = stats ? stats.totalBalance : null;
  const criticalCustomers = stats ? stats.watchlist : null;
  const openComplaints = complaints ? complaints.filter((c) => c.status !== 'resolved').length : null;

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        title="Overview"
        subtitle="Bank-wide health at a glance — churn exposure, book value, sentiment, and open cases."
        action={
          <button onClick={loadLive} className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5">
            <RefreshCw size={12} /> {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Refresh'}
          </button>
        }
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Customers tracked" value={stats ? stats.total.toLocaleString() : '—'} icon={Users} tone="gold" />
        <StatCard
          label="Critical risk"
          value={stats ? stats.byRiskLevel.critical.toLocaleString() : '—'}
          sub={stats ? `₹${(stats.balanceAtRisk / 10000000).toFixed(2)}Cr at risk` : undefined}
          icon={ShieldAlert}
          tone="red"
        />
        <StatCard
          label="Book value"
          value={totalBalance !== null ? `₹${(totalBalance / 10000000).toFixed(2)}Cr` : '—'}
          icon={Wallet}
          tone="gold"
        />
        <StatCard label="Open complaints" value={openComplaints !== null ? openComplaints : '—'} icon={Inbox} tone="blue" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Critical watchlist" noPad className="col-span-2">
          {!criticalCustomers ? (
            <div className="p-5 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-10" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-modern">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Branch</th>
                    <th>Risk</th>
                    <th>Recommended action</th>
                  </tr>
                </thead>
                <tbody>
                  {criticalCustomers.map((c) => (
                    <tr key={c.customerId}>
                      <td className="text-white font-medium">{c.surname}</td>
                      <td className="text-gray-400">{c.branch}</td>
                      <td><RiskBadge level={c.churnRiskLevel}>{c.churnRiskScore.toFixed(0)}%</RiskBadge></td>
                      <td className="text-gray-400 text-xs">{c.recommendedAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link to="/pulse" className="flex items-center gap-1.5 text-xs text-gold font-medium px-5 py-3 border-t border-white/[0.05] hover:underline w-fit">
            View full Churn Pulse <ArrowRight size={12} />
          </Link>
        </Card>

        <Card title="Risk distribution">
          {!riskCounts ? (
            <div className="skeleton h-40" />
          ) : (
            <>
              <div className="h-36">
                <Doughnut
                  data={{
                    labels: RISK_ORDER,
                    datasets: [{ data: riskCounts, backgroundColor: RISK_ORDER.map((l) => RISK_COLORS[l]), borderWidth: 0 }],
                  }}
                  options={{
                    maintainAspectRatio: false,
                    cutout: '68%',
                    plugins: { legend: { display: false } },
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-4">
                {RISK_ORDER.map((level, i) => (
                  <div key={level} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RISK_COLORS[level] }} />
                    <span className="text-gray-400 capitalize">{level}</span>
                    <span className="text-white font-medium ml-auto">{riskCounts[i]}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Card title="Market sentiment">
          {!sentiment ? (
            <div className="skeleton h-16" />
          ) : (
            <Link to="/sentiment" className="flex items-center gap-3 group">
              <div className="w-11 h-11 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
                <Sparkles size={18} className="text-gold" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white tabular-nums">{sentiment.composite_score}<span className="text-sm text-gray-500 font-normal"> / 100</span></div>
                <div className="text-xs text-gray-500 group-hover:text-gold transition-colors flex items-center gap-1">
                  View breakdown <ArrowRight size={11} />
                </div>
              </div>
            </Link>
          )}
        </Card>

        <Card title="Growth trend">
          {!forecast ? (
            <div className="skeleton h-16" />
          ) : (
            <Link to="/forecast" className="flex items-center gap-3 group">
              <div className="w-11 h-11 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
                <TrendingUp size={18} className="text-gold" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white tabular-nums">
                  {forecast.trend_slope_customers_per_year > 0 ? '+' : ''}{forecast.trend_slope_customers_per_year}
                  <span className="text-sm text-gray-500 font-normal"> /yr</span>
                </div>
                <div className="text-xs text-gray-500 group-hover:text-gold transition-colors flex items-center gap-1">
                  View forecast <ArrowRight size={11} />
                </div>
              </div>
            </Link>
          )}
        </Card>

        <Card title="Complaint inbox">
          {!complaints ? (
            <div className="skeleton h-16" />
          ) : (
            <Link to="/complaints" className="flex items-center gap-3 group">
              <div className="w-11 h-11 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
                <Inbox size={18} className="text-gold" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white tabular-nums">{openComplaints}<span className="text-sm text-gray-500 font-normal"> open</span></div>
                <div className="text-xs text-gray-500 group-hover:text-gold transition-colors flex items-center gap-1">
                  Go to Resolve <ArrowRight size={11} />
                </div>
              </div>
            </Link>
          )}
        </Card>
      </div>

      <Card title="Live activity" className="mt-4" noPad action={<span className="text-[11px] text-gray-500 flex items-center gap-1"><Activity size={11} /> auto-refreshes every 30s</span>}>
        {!activity ? (
          <div className="p-5 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-8" />)}</div>
        ) : activity.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No activity yet — log a complaint or trigger an outreach.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {activity.map((e, i) => {
              const meta = {
                complaint_logged: { Icon: Inbox, cls: 'text-risk-medium', to: '/complaints' },
                complaint_update: { Icon: CheckCircle2, cls: 'text-gray-400', to: '/complaints' },
                outreach_triggered: { Icon: Megaphone, cls: 'text-gold', to: `/customers/${e.ref.customerId}` },
                outreach_outcome: { Icon: CheckCircle2, cls: 'text-risk-low', to: '/outreach' },
              }[e.type] || { Icon: Activity, cls: 'text-gray-400', to: '/' };
              const Icon = meta.Icon;
              return (
                <li key={i}>
                  <Link to={meta.to} className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.03] transition-colors">
                    <Icon size={14} className={meta.cls} />
                    <span className="text-sm text-gray-200 flex-1 truncate">{e.title}</span>
                    {e.severity && <RiskBadge level={e.severity}>{e.severity}</RiskBadge>}
                    {e.audit && <span className={`badge ${e.audit === 'stored' ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>chain: {e.audit}</span>}
                    <span className="text-xs text-gray-500 whitespace-nowrap">{new Date(e.at).toLocaleTimeString()}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
