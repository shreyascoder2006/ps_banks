import { Bar } from 'react-chartjs-2';
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js';
import { Coins, MousePointerClick, Search, Target, Users } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getElementAtEvent } from 'react-chartjs-2';
import { client } from '../api/client';
import { RiskBadge } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import { baseGridOptions, chartColors } from '../lib/chartTheme';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const SEGMENT_COLORS = {
  Champions: chartColors.gold,
  'Loyal Customers': chartColors.green,
  'Potential Loyalists': chartColors.blue,
  'At-Risk': '#f59e0b',
  Hibernating: '#64748b',
  Others: '#94a3b8',
};

export default function Segments() {
  const chartRef = useRef(null);
  const [summary, setSummary] = useState([]);
  const [active, setActive] = useState('At-Risk');
  const [members, setMembers] = useState(null);
  const [winBack, setWinBack] = useState(10);
  const [impact, setImpact] = useState(null);
  const [customerId, setCustomerId] = useState('');
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/segments').then((res) => setSummary(res.data.summary));
  }, []);

  useEffect(() => {
    setMembers(null);
    client.get('/segments/customers', { params: { segment: active, limit: 15 } }).then((res) => setMembers(res.data));
  }, [active]);

  useEffect(() => {
    client.get('/segments/impact', { params: { segment: active, win_back_pct: winBack } }).then((res) => setImpact(res.data));
  }, [active, winBack]);

  const onBarClick = (e) => {
    const el = getElementAtEvent(chartRef.current, e);
    if (el.length) setActive(summary[el[0].index].segment);
  };

  const lookupOffer = async (e) => {
    e.preventDefault();
    setError('');
    setOffer(null);
    if (!customerId.trim()) return;
    try {
      const res = await client.get(`/segments/${customerId}/offer`);
      setOffer(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Customer not found');
    }
  };

  const data = {
    labels: summary.map((s) => s.segment),
    datasets: [{
      data: summary.map((s) => s.count),
      backgroundColor: summary.map((s) => (s.segment === active ? SEGMENT_COLORS[s.segment] : `${SEGMENT_COLORS[s.segment]}55`)),
      borderColor: summary.map((s) => (s.segment === active ? '#fff' : 'transparent')),
      borderWidth: 1,
      borderRadius: 6,
      maxBarThickness: 56,
    }],
  };

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Segments & Offers"
        subtitle="Click a segment to drill in. The campaign simulator uses real balances and real model scores — no invented uplift."
      />

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card title="Customer distribution by segment" className="col-span-2" action={<span className="text-[11px] text-gray-500 flex items-center gap-1"><MousePointerClick size={11} /> click a bar</span>}>
          <div className="h-64">
            <Bar ref={chartRef} data={data} onClick={onBarClick} options={baseGridOptions({ plugins: { legend: { display: false } }, onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } })} />
          </div>
        </Card>

        <Card title={`Campaign simulator · ${active}`} action={<Target size={14} className="text-gold" />}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-300">Win back</span>
            <span className="text-white tabular-nums">{winBack}% of at-risk</span>
          </div>
          <input type="range" min={0} max={100} step={5} value={winBack} onChange={(e) => setWinBack(Number(e.target.value))} className="w-full accent-[#d4af37] mb-4" />
          {impact ? (
            <div className="space-y-2.5 fade-in">
              <div className="flex justify-between text-sm"><span className="text-gray-400">At-risk in segment</span><span className="text-white tabular-nums">{impact.atRiskCount} / {impact.segmentSize}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">Balance exposed</span><span className="text-white tabular-nums">₹{(impact.atRiskBalance / 10000000).toFixed(2)}Cr</span></div>
              <div className="border-t border-white/[0.06] pt-2.5" />
              <div className="flex justify-between text-sm"><span className="text-gray-400">Customers retained</span><span className="text-gold font-semibold tabular-nums">{impact.customersRetained}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">Balance protected</span><span className="text-gold font-semibold tabular-nums">₹{(impact.balanceProtected / 10000000).toFixed(2)}Cr</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">Expected churners avoided</span><span className="text-risk-low font-semibold tabular-nums">{impact.expectedChurnersAvoided}</span></div>
              <p className="text-[11px] text-gray-500 pt-1">{impact.note}</p>
            </div>
          ) : <div className="skeleton h-32" />}
        </Card>
      </div>

      <Card title={`${active} · highest-risk members`} noPad className="mb-4" action={members && <span className="text-xs text-gray-500">{members.total} in segment</span>}>
        {!members ? (
          <div className="p-5 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-10" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-modern">
              <thead><tr><th>Customer</th><th>Branch</th><th>Risk</th><th>Balance</th><th>Offer</th><th>Tokens</th><th></th></tr></thead>
              <tbody>
                {members.customers.map((m) => (
                  <tr key={m.customerId}>
                    <td className="text-white font-medium">{m.surname}</td>
                    <td className="text-gray-400">{m.branch}</td>
                    <td><RiskBadge level={m.churnRiskLevel}>{Math.round(m.churnRiskScore)}%</RiskBadge></td>
                    <td className="text-gray-300 tabular-nums">₹{Math.round(m.monetary).toLocaleString('en-IN')}</td>
                    <td className="text-gray-400 text-xs">{m.offerType}</td>
                    <td className="text-gold tabular-nums text-xs">{m.loyaltyTokens}</td>
                    <td><Link to={`/customers/${m.customerId}`} className="text-xs text-gold hover:underline">360 →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Personalised offer & loyalty tokens lookup">
        <form onSubmit={lookupOffer} className="flex gap-2 mb-4">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input className="input-field pl-8 py-2" placeholder="Customer ID e.g. 15634602" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary px-5 text-sm">Lookup</button>
        </form>
        {error && <div className="px-3 py-2 rounded-lg bg-risk-critical/10 border border-risk-critical/20 text-red-300 text-sm">{error}</div>}
        {offer && (
          <div className="fade-in grid grid-cols-[auto_1fr] gap-x-5 items-start rounded-lg bg-white/[0.03] border border-white/[0.06] p-4">
            <div className="w-11 h-11 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center"><Coins size={18} className="text-gold" /></div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white font-semibold">{offer.segment}</span>
                <span className="badge bg-gold/15 text-gold">{offer.loyaltyTokens} tokens</span>
                <Link to={`/customers/${offer.customerId}`} className="text-xs text-gray-400 hover:text-gold ml-auto">Open 360 →</Link>
              </div>
              <div className="text-sm text-gold/90 font-medium mb-1">{offer.offer_type}</div>
              <p className="text-sm text-gray-400 leading-relaxed">{offer.message}</p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
