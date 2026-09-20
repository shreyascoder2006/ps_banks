import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import {
  ArrowRight, Inbox, LayoutDashboard, ShieldAlert, Sparkles, TrendingUp, Users, Wallet,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
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
const RISK_COLORS = { critical: chartColors.red, high: '#f59e0b', medium: chartColors.blue, low: chartColors.green };

export default function Overview() {
  const [customers, setCustomers] = useState(null);
  const [sentiment, setSentiment] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [complaints, setComplaints] = useState(null);

  useEffect(() => {
    client.get('/customers', { params: { limit: 500 } }).then((res) => setCustomers(res.data.customers));
    client.get('/sentiment/market').then((res) => setSentiment(res.data));
    client.get('/forecast/growth', { params: { periods: 1 } }).then((res) => setForecast(res.data));
    client.get('/complaints').then((res) => setComplaints(res.data.complaints));
  }, []);

  const riskCounts = customers
    ? RISK_ORDER.map((level) => customers.filter((c) => c.churnRiskLevel === level).length)
    : null;
  const totalBalance = customers ? customers.reduce((s, c) => s + c.balance, 0) : null;
  const criticalCustomers = customers
    ? [...customers].sort((a, b) => b.churnRiskScore - a.churnRiskScore).slice(0, 5)
    : null;
  const openComplaints = complaints ? complaints.filter((c) => c.status === 'open').length : null;

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        title="Overview"
        subtitle="Bank-wide health at a glance — churn exposure, book value, sentiment, and open cases."
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Customers tracked" value={customers ? customers.length : '—'} icon={Users} tone="gold" />
        <StatCard
          label="Critical risk"
          value={customers ? customers.filter((c) => c.churnRiskLevel === 'critical').length : '—'}
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
    </div>
  );
}
