import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { client } from '../api/client';
import Card from '../components/Card';

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function Forecast() {
  const [data, setData] = useState(null);

  useEffect(() => {
    client.get('/forecast/growth', { params: { periods: 4 } }).then((res) => setData(res.data));
  }, []);

  if (!data) return <p className="text-gray-400">Loading...</p>;

  const labels = [...data.history.map((h) => h.year), ...data.forecast.map((f) => f.year)];
  const historyLine = [...data.history.map((h) => h.new_customers), ...Array(data.forecast.length).fill(null)];
  const forecastLine = [...Array(data.history.length - 1).fill(null), data.history.at(-1).new_customers, ...data.forecast.map((f) => f.new_customers_forecast)];

  const chartData = {
    labels,
    datasets: [
      { label: 'New customers (actual, real tenure cohorts)', data: historyLine, borderColor: '#d4af37', backgroundColor: '#d4af37' },
      { label: 'Forecast (linear trend, illustrative)', data: forecastLine, borderColor: '#60a5fa', borderDash: [6, 4], backgroundColor: '#60a5fa' },
    ],
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Customer Growth Forecast</h1>
      <Card title={`Method: ${data.method}`}>
        <div className="h-72">
          <Line data={chartData} options={{ maintainAspectRatio: false, scales: { x: { ticks: { color: '#ccc' } }, y: { ticks: { color: '#ccc' } } }, plugins: { legend: { labels: { color: '#ccc' } } } }} />
        </div>
      </Card>
      <Card title="Current book">
        <p className="text-sm text-gray-300">Total balance across all customers: ₹{data.total_balance_current.toLocaleString('en-IN')}</p>
        <p className="text-sm text-gray-300">Trend slope: {data.trend_slope_customers_per_year} new customers/year</p>
      </Card>
    </div>
  );
}
