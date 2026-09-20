import { Bar } from 'react-chartjs-2';
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js';
import { Coins, Search, Users } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
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
  const [summary, setSummary] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get('/segments').then((res) => setSummary(res.data.summary));
  }, []);

  const lookupOffer = async (e) => {
    e.preventDefault();
    setError('');
    setOffer(null);
    if (!customerId.trim()) return;
    setLoading(true);
    try {
      const res = await client.get(`/segments/${customerId}/offer`);
      setOffer(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Customer not found');
    } finally {
      setLoading(false);
    }
  };

  const data = {
    labels: summary.map((s) => s.segment),
    datasets: [{
      data: summary.map((s) => s.count),
      backgroundColor: summary.map((s) => SEGMENT_COLORS[s.segment] || chartColors.gold),
      borderRadius: 6,
      maxBarThickness: 56,
    }],
  };

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Segments & Offers"
        subtitle="RFM-style segmentation — recency/frequency proxies blended with real account balance as the monetary signal."
      />

      <Card title="Customer distribution by segment" className="mb-6">
        <div className="h-64">
          <Bar data={data} options={baseGridOptions({ plugins: { legend: { display: false } } })} />
        </div>
      </Card>

      <Card title="Personalised offer & loyalty tokens">
        <form onSubmit={lookupOffer} className="flex gap-2 mb-5">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input-field pl-8 py-2"
              placeholder="Customer ID e.g. 15634602"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary px-5 text-sm">
            {loading ? 'Looking up...' : 'Lookup'}
          </button>
        </form>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-risk-critical/10 border border-risk-critical/20 text-red-300 text-sm mb-2">
            {error}
          </div>
        )}

        {offer && (
          <div className="fade-in grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 items-start rounded-lg bg-white/[0.03] border border-white/[0.06] p-4">
            <div className="w-11 h-11 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center">
              <Coins size={18} className="text-gold" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white font-semibold">{offer.segment}</span>
                <span className="badge bg-gold/15 text-gold">{offer.loyaltyTokens} tokens</span>
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
