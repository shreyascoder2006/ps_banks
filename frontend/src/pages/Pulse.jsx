import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import Card from '../components/Card';

const RISK_COLORS = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#22c55e' };

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Churn Pulse</h1>

      {metrics && (
        <Card title="Model performance (RandomForestClassifier, real held-out test set)">
          <div className="flex gap-8 text-sm text-gray-300">
            <div>AUC: <span className="text-gold">{metrics.metrics.auc.toFixed(3)}</span></div>
            <div>Accuracy: <span className="text-gold">{(metrics.metrics.accuracy * 100).toFixed(1)}%</span></div>
            <div>Train/Test split: {metrics.metrics.n_train} / {metrics.metrics.n_test}</div>
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        {['', 'critical', 'high', 'medium', 'low'].map((lvl) => (
          <button
            key={lvl}
            onClick={() => setRiskLevel(lvl)}
            className={`px-3 py-1 rounded text-sm ${riskLevel === lvl ? 'bg-gold text-navy-dark' : 'bg-white/5 text-gray-300'}`}
          >
            {lvl || 'All'}
          </button>
        ))}
      </div>

      <Card title={`Customers (${customers.length})`}>
        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left">
              <tr>
                <th className="py-2">Customer</th>
                <th>Branch</th>
                <th>Segment</th>
                <th>Risk</th>
                <th>Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.customerId} className="border-t border-white/5">
                  <td className="py-2">{c.surname} ({c.accountNo})</td>
                  <td>{c.branch}</td>
                  <td className="capitalize">{c.segment}</td>
                  <td>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-semibold"
                      style={{ backgroundColor: RISK_COLORS[c.churnRiskLevel] + '30', color: RISK_COLORS[c.churnRiskLevel] }}
                    >
                      {c.churnRiskScore.toFixed(0)}% {c.churnRiskLevel}
                    </span>
                  </td>
                  <td>₹{c.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                  <td>
                    <button className="text-gold text-xs hover:underline" onClick={() => setSelected(c)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="card p-6 w-[480px]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-gold font-bold mb-2">{selected.surname} — {selected.accountNo}</h2>
            <p className="text-sm text-gray-300 mb-1">Risk: {selected.churnRiskScore.toFixed(1)}% ({selected.churnRiskLevel})</p>
            <p className="text-sm text-gray-300 mb-1">Recommended action: {selected.recommendedAction}</p>
            <p className="text-sm text-gray-400 mb-2">Products: {selected.products.join(', ')}</p>
            <div className="text-sm text-gray-300">
              <p className="text-gold text-xs uppercase mb-1">Drivers</p>
              <ul className="list-disc list-inside space-y-1">
                {selected.churnDrivers.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
            <button className="mt-4 text-xs text-gray-400 hover:text-white" onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
