import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { ArrowLeft, BarChart3, Clock, Download, FileWarning, ShieldCheck, Smile, TriangleAlert } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { Link } from 'react-router-dom';
import { client } from '../api/client';
import { Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { baseGridOptions, chartColors } from '../lib/chartTheme';

ChartJS.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip);

const SEV_COLORS = { critical: chartColors.red, high: '#f59e0b', medium: chartColors.blue, low: chartColors.green };

export default function ComplaintInsights() {
  const [t, setT] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);

  useEffect(() => {
    client.get('/complaints/trends').then((res) => setT(res.data));
  }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await client.get('/complaints/regulatory-export');
      setExportResult(res.data);
      if (res.data.csv) {
        const blob = new Blob([res.data.csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `regulatory_export_${res.data.generated_at.slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  };

  if (!t) return <div className="skeleton h-96" />;

  const cats = Object.entries(t.by_category);
  const weeks = Object.entries(t.weekly_volume);

  return (
    <div>
      <Link to="/complaints" className="flex items-center gap-1 text-xs text-gray-500 hover:text-gold mb-3"><ArrowLeft size={12} /> Back to inbox</Link>
      <PageHeader
        icon={BarChart3}
        title="Complaint Insights"
        subtitle="Trend analysis, root-cause terms mined from real complaint text, and a tamper-evident regulatory export."
        action={
          <button onClick={doExport} disabled={exporting} className="btn-primary px-4 py-2 text-sm flex items-center gap-1.5">
            {exporting ? <Spinner size={13} className="text-navy-dark" /> : <Download size={14} />} Regulatory export (CSV)
          </button>
        }
      />

      {exportResult && (
        <div className={`fade-in mb-4 rounded-lg border px-4 py-3 text-sm flex items-center gap-3 ${exportResult.audit?.status === 'stored' ? 'bg-risk-low/[0.06] border-risk-low/20' : 'bg-white/[0.03] border-white/[0.06]'}`}>
          <ShieldCheck size={16} className={exportResult.audit?.status === 'stored' ? 'text-risk-low' : 'text-gray-500'} />
          <span className="text-gray-200">Exported <span className="text-gold font-semibold">{exportResult.case_count}</span> reportable case(s) · audit {exportResult.audit?.status}</span>
          {exportResult.audit?.tx_hash && <span className="text-gray-500 font-mono text-xs truncate">tx {exportResult.audit.tx_hash}</span>}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total complaints" value={t.total} icon={FileWarning} tone="gold" />
        <StatCard label="SLA breach rate" value={`${(t.sla_breach_rate * 100).toFixed(0)}%`} sub={`${t.sla_breached} breached`} icon={TriangleAlert} tone={t.sla_breached > 0 ? 'red' : 'green'} />
        <StatCard label="Avg resolution" value={t.avg_resolution_hours != null ? `${t.avg_resolution_hours}h` : '—'} icon={Clock} tone="blue" />
        <StatCard label="Avg AI sentiment" value={t.avg_ai_sentiment != null ? t.avg_ai_sentiment.toFixed(2) : '—'} sub="0 = very negative, 1 = positive" icon={Smile} tone={t.avg_ai_sentiment != null && t.avg_ai_sentiment < 0.4 ? 'red' : 'green'} />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card title="Volume by category" className="col-span-2">
          <div className="h-56">
            <Bar
              data={{ labels: cats.map(([k]) => k), datasets: [{ data: cats.map(([, v]) => v), backgroundColor: chartColors.gold, borderRadius: 4, maxBarThickness: 40 }] }}
              options={baseGridOptions({ plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: chartColors.text } }, y: { grid: { color: chartColors.grid }, ticks: { color: chartColors.text, precision: 0 } } } })}
            />
          </div>
        </Card>
        <Card title="By severity">
          <div className="space-y-2">
            {['critical', 'high', 'medium', 'low'].map((s) => {
              const v = t.by_severity[s] || 0;
              const pct = t.total ? (v / t.total) * 100 : 0;
              return (
                <div key={s}>
                  <div className="flex justify-between text-xs mb-1"><span className="capitalize text-gray-300">{s}</span><span className="text-gray-400 tabular-nums">{v}</span></div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: SEV_COLORS[s] }} /></div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-white/[0.05]">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">By channel</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(t.by_channel).map(([k, v]) => <span key={k} className="badge bg-white/[0.06] text-gray-300 capitalize">{k} · {v}</span>)}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Weekly volume">
          <div className="h-40">
            <Line
              data={{ labels: weeks.map(([k]) => k), datasets: [{ data: weeks.map(([, v]) => v), borderColor: chartColors.blue, backgroundColor: 'rgba(56,189,248,0.1)', fill: true, tension: 0.3, pointRadius: 3 }] }}
              options={baseGridOptions({ plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: chartColors.text } }, y: { grid: { color: chartColors.grid }, ticks: { color: chartColors.text, precision: 0 } } } })}
            />
          </div>
        </Card>
        <Card title="Root-cause terms (TF-IDF per category)" className="col-span-2">
          <div className="space-y-2.5">
            {Object.entries(t.root_cause_terms).map(([cat, terms]) => (
              <div key={cat} className="flex items-start gap-3">
                <span className="text-xs text-gray-400 w-32 shrink-0 pt-0.5">{cat}</span>
                <div className="flex flex-wrap gap-1.5">
                  {terms.map((term) => <span key={term} className="badge bg-gold/10 text-gold border border-gold/15">{term}</span>)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-white/[0.05]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Root-cause narrative</span>
              <span className={`badge ${['groq', 'gemini'].includes(t.narrative.source) ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>{t.narrative.source}</span>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">{t.narrative.text}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
