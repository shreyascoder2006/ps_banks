import { CategoryScale, Chart as ChartJS, Filler, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { TrendingUp, Wallet } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { client } from '../api/client';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { baseGridOptions, chartColors } from '../lib/chartTheme';

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler);

export default function Forecast() {
  const [data, setData] = useState(null);

  useEffect(() => {
    client.get('/forecast/growth', { params: { periods: 4 } }).then((res) => setData(res.data));
  }, []);

  if (!data) {
    return (
      <div>
        <PageHeader icon={TrendingUp} title="Customer Growth Forecast" />
        <div className="skeleton h-80" />
      </div>
    );
  }

  const labels = [...data.history.map((h) => h.year), ...data.forecast.map((f) => f.year)];
  const historyLine = [...data.history.map((h) => h.new_customers), ...Array(data.forecast.length).fill(null)];
  const forecastLine = [
    ...Array(data.history.length - 1).fill(null),
    data.history.at(-1).new_customers,
    ...data.forecast.map((f) => f.new_customers_forecast),
  ];

  const chartData = {
    labels,
    datasets: [
      {
        label: 'New customers (actual)',
        data: historyLine,
        borderColor: chartColors.gold,
        backgroundColor: 'rgba(212,175,55,0.08)',
        pointBackgroundColor: chartColors.gold,
        pointRadius: 3,
        fill: true,
        tension: 0.3,
      },
      {
        label: 'Forecast (linear trend)',
        data: forecastLine,
        borderColor: chartColors.blue,
        borderDash: [6, 4],
        pointBackgroundColor: chartColors.blue,
        pointRadius: 3,
        fill: false,
        tension: 0.3,
      },
    ],
  };

  return (
    <div>
      <PageHeader
        icon={TrendingUp}
        title="Customer Growth Forecast"
        subtitle={`Method: ${data.method}`}
      />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard
          label="Total balance on book"
          value={`₹${(data.total_balance_current / 10000000).toFixed(2)}Cr`}
          icon={Wallet}
          tone="gold"
        />
        <StatCard
          label="Trend slope"
          value={`${data.trend_slope_customers_per_year > 0 ? '+' : ''}${data.trend_slope_customers_per_year}`}
          sub="new customers / year"
          icon={TrendingUp}
          tone={data.trend_slope_customers_per_year >= 0 ? 'green' : 'red'}
        />
      </div>

      <Card title="Growth trajectory">
        <div className="h-72">
          <Line data={chartData} options={baseGridOptions()} />
        </div>
      </Card>
    </div>
  );
}
