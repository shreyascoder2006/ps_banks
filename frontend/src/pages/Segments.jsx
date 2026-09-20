import React, { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { client } from '../api/client';
import Card from '../components/Card';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

export default function Segments() {
  const [summary, setSummary] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/segments').then((res) => setSummary(res.data.summary));
  }, []);

  const lookupOffer = async () => {
    setError('');
    setOffer(null);
    try {
      const res = await client.get(`/segments/${customerId}/offer`);
      setOffer(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Not found');
    }
  };

  const data = {
    labels: summary.map((s) => s.segment),
    datasets: [{ label: 'Customers', data: summary.map((s) => s.count), backgroundColor: '#d4af37' }],
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Segments & Offers</h1>

      <Card title="RFM-style segments (Recency/Frequency proxy, real Balance as Monetary)">
        <div className="h-64">
          <Bar data={data} options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#ccc' } }, y: { ticks: { color: '#ccc' } } } }} />
        </div>
      </Card>

      <Card title="Personalised offer & loyalty tokens lookup">
        <div className="flex gap-2 mb-4">
          <input
            className="p-2 rounded bg-navy border border-gold/20 text-white text-sm"
            placeholder="Customer ID e.g. 15634602"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
          <button onClick={lookupOffer} className="bg-gold text-navy-dark px-4 rounded text-sm font-semibold">
            Lookup
          </button>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {offer && (
          <div className="text-sm text-gray-300 space-y-1">
            <p>Segment: <span className="text-gold">{offer.segment}</span></p>
            <p>Loyalty tokens: <span className="text-gold">{offer.loyaltyTokens}</span></p>
            <p>Offer: {offer.offer_type}</p>
            <p className="text-gray-400">{offer.message}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
