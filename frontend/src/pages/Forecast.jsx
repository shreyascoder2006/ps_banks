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
  const [periods, setPeriods] = useState(4);
  const [scenario, setScenario] = useState(0);

  useEffect(() => {
    client.get('/forecast/growth', { params: { periods } }).then((res) => setData(res.data));
  }, [periods]);

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
  const scenarioLine = scenario === 0 ? null : [
    ...Array(data.history.length - 1).fill(null),
    data.history.at(-1).new_customers,
    ...data.forecast.map((f, i) => Math.round(f.new_customers_forecast * (1 + scenario / 100) ** (i + 1))),
  ];
  const scenarioTotal = scenarioLine ? scenarioLine.slice(data.history.length).reduce((a, b) => a + b, 0) : null;
  const baseTotal = data.forecast.reduce((a, f) => a + f.new_customers_forecast, 0);

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
      ...(scenarioLine ? [{
        label: `Scenario (${scenario > 0 ? '+' : ''}${scenario}%/yr)`,
        data: scenarioLine,
        borderColor: scenario > 0 ? chartColors.green : chartColors.red,
        borderDash: [2, 3],
        pointRadius: 3,
        pointBackgroundColor: scenario > 0 ? chartColors.green : chartColors.red,
        fill: false,
        tension: 0.3,
      }] : []),
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
        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-300">Forecast horizon</span>
              <span className="text-white tabular-nums">{periods} yr</span>
            </div>
            <input type="range" min={1} max={8} step={1} value={periods} onChange={(e) => setPeriods(Number(e.target.value))} className="w-full accent-[#d4af37]" />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-300">Growth scenario (vs. trend)</span>
              <span className={`tabular-nums ${scenario > 0 ? 'text-risk-low' : scenario < 0 ? 'text-risk-critical' : 'text-white'}`}>{scenario > 0 ? '+' : ''}{scenario}% / yr</span>
            </div>
            <input type="range" min={-20} max={20} step={1} value={scenario} onChange={(e) => setScenario(Number(e.target.value))} className="w-full accent-[#d4af37]" />
          </div>
        </div>
        <div className="h-72">
          <Line data={chartData} options={baseGridOptions()} />
        </div>
        {scenarioLine && (
          <div className="mt-3 text-sm text-gray-400 flex items-center gap-2 fade-in">
            Over {periods} yr: trend <span className="text-white tabular-nums">{Math.round(baseTotal).toLocaleString()}</span> new customers vs. scenario
            <span className={`font-semibold tabular-nums ${scenario > 0 ? 'text-risk-low' : 'text-risk-critical'}`}>{scenarioTotal.toLocaleString()}</span>
            ({scenarioTotal - Math.round(baseTotal) > 0 ? '+' : ''}{(scenarioTotal - Math.round(baseTotal)).toLocaleString()})
          </div>
        )}
      </Card>
    </div>
  );
}
