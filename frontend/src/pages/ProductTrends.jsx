import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import Card from '../components/Card';

const STATUS_COLORS = { trending: '#22c55e', stable: '#60a5fa', declining: '#ef4444' };

export default function ProductTrends() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    client.get('/trends/products').then((res) => setProducts(res.data.products));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Product Uptake Trends</h1>
      <p className="text-sm text-gray-400">
        Derived from real product-holding data, comparing newer (≤3y tenure) vs established customer cohorts —
        not a fabricated time series.
      </p>
      <Card>
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-left">
            <tr>
              <th className="py-2">Product</th>
              <th>New-cohort adoption</th>
              <th>Established-cohort adoption</th>
              <th>Trend score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.product} className="border-t border-white/5">
                <td className="py-2 capitalize">{p.product.replace('_', ' ')}</td>
                <td>{p.adoption_rate_new_cohort}%</td>
                <td>{p.adoption_rate_established_cohort}%</td>
                <td>{p.trend_score}</td>
                <td>
                  <span style={{ color: STATUS_COLORS[p.status] }} className="font-semibold capitalize">{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
