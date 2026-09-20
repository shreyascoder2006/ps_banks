import { ArrowDownRight, ArrowUpRight, LineChart, Minus } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';

const STATUS_META = {
  trending: { color: 'text-risk-low bg-risk-low/10 border-risk-low/20', Icon: ArrowUpRight },
  declining: { color: 'text-risk-critical bg-risk-critical/10 border-risk-critical/20', Icon: ArrowDownRight },
  stable: { color: 'text-risk-medium bg-risk-medium/10 border-risk-medium/20', Icon: Minus },
};

function Bar({ value, max }) {
  return (
    <div className="w-24 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
      <div className="h-full rounded-full bg-gold/70 transition-all duration-300" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}

export default function ProductTrends() {
  const [data, setData] = useState(null);
  const [maxTenure, setMaxTenure] = useState(3);
  const [geo, setGeo] = useState('');

  useEffect(() => {
    client.get('/trends/products', { params: { max_tenure: maxTenure, ...(geo ? { geography: geo } : {}) } }).then((res) => setData(res.data));
  }, [maxTenure, geo]);

  const products = data?.products ?? [];
  const max = Math.max(1, ...products.map((p) => Math.max(p.adoption_rate_new_cohort, p.adoption_rate_established_cohort)));

  return (
    <div>
      <PageHeader
        icon={LineChart}
        title="Product Uptake Trends"
        subtitle="Real product-holding data compared across newer vs. established customer cohorts — move the threshold to re-cut the cohorts live."
      />

      <Card className="mb-4">
        <div className="grid grid-cols-[1fr_auto] gap-6 items-end">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-300">"New" cohort = tenure ≤</span>
              <span className="text-white tabular-nums">{maxTenure} yr</span>
            </div>
            <input type="range" min={0} max={9} step={1} value={maxTenure} onChange={(e) => setMaxTenure(Number(e.target.value))} className="w-full accent-[#d4af37]" />
            {data && (
              <div className="text-xs text-gray-500 mt-1">
                {data.cohorts.new.toLocaleString()} newer vs. {data.cohorts.established.toLocaleString()} established customers
              </div>
            )}
          </div>
          <div>
            <div className="text-sm text-gray-300 mb-1">Geography</div>
            <select className="input-field py-1.5 text-xs w-40" value={geo} onChange={(e) => setGeo(e.target.value)}>
              <option value="">All</option>
              {(data?.geographies ?? []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card noPad>
        {!data ? (
          <div className="p-5 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-10" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-modern">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>New-cohort adoption</th>
                  <th>Established-cohort adoption</th>
                  <th>Trend score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const meta = STATUS_META[p.status];
                  const Icon = meta.Icon;
                  return (
                    <tr key={p.product}>
                      <td className="text-white font-medium capitalize">{p.product.replace('_', ' ')}</td>
                      <td><div className="flex items-center gap-2.5"><Bar value={p.adoption_rate_new_cohort} max={max} /><span className="text-gray-300 tabular-nums text-xs">{p.adoption_rate_new_cohort}%</span></div></td>
                      <td><div className="flex items-center gap-2.5"><Bar value={p.adoption_rate_established_cohort} max={max} /><span className="text-gray-300 tabular-nums text-xs">{p.adoption_rate_established_cohort}%</span></div></td>
                      <td className="text-gray-300 tabular-nums">{p.trend_score}</td>
                      <td><span className={`badge border ${meta.color}`}><Icon size={12} /> {p.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
