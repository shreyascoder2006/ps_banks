import {
  Activity, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Network, Search, UserSearch, X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ExplainBars from '../components/ExplainBars';
import {
  Calibration, ConfusionMatrix, DriftList, Limitations, MetricStrip, ModelProvenance,
} from '../components/ModelHealth';
import OutreachPanel from '../components/OutreachPanel';
import PageHeader from '../components/PageHeader';
import SignalNetwork from '../components/SignalNetwork';
import ScoreTrend from '../components/ScoreTrend';
import {
  BarList, Boundary, DistributionBar, EmptyState, fmt, Provenance, RiskMeter, Section, SeverityBadge, Tabs,
} from '../components/ui';
import { useDebounce } from '../lib/hooks';
import { useEvent } from '../lib/realtime';
import { useApi } from '../lib/useApi';

const FEATURE_LABELS = {
  CreditScore: 'Credit score',
  Age: 'Age',
  Tenure: 'Tenure',
  Balance: 'Balance',
  'Num Of Products': 'Products held',
  'Has Credit Card': 'Has credit card',
  'Is Active Member': 'Active member',
  'Estimated Salary': 'Estimated salary',
  Geography_enc: 'Geography',
  Gender_enc: 'Gender',
};
const PAGE = 25;
const MODEL_TABS = [
  { id: 'importance', label: 'Feature importance' },
  { id: 'confusion', label: 'Confusion matrix' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'drift', label: 'Drift & data quality' },
  { id: 'limits', label: 'Limitations' },
];

/* ------------------------------------------------------------------ global model */
function GlobalModel() {
  const health = useApi('/model/health');
  const metrics = useApi('/customers/model/metrics');
  const [tab, setTab] = useState('importance');
  useEvent(['model_retrained'], () => { health.reload(); metrics.reload(); });

  return (
    <Section title="Global model behaviour" className="h-full"
      hint="How the model performs across all customers. This says nothing about any one person — that is in the customer panel below.">
      <Boundary state={health} rows={6}>
        {(h) => (
          <div className="space-y-5">
            <ModelProvenance h={h} />
            <MetricStrip h={h} />
            <div>
              <Tabs tabs={MODEL_TABS} value={tab} onChange={setTab} label="Model diagnostics" />
              <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-4 page-enter" key={tab}>
                {tab === 'importance' && (
                  <Boundary state={metrics} rows={5}>
                    {(m) => {
                      const items = Object.entries(m.feature_importances).sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => ({ label: FEATURE_LABELS[k] || k, value: Math.round(v * 1000) / 10, hint: `${FEATURE_LABELS[k] || k}: ${(v * 100).toFixed(1)}% of the forest's split weight` }));
                      return (
                        <>
                          <BarList items={items} unit="%" labelWidth={116} />
                          <p className="text-[11px] text-gray-500 mt-3">Share of the Random Forest's total split weight per input. It shows what the model leans on, not whether a feature causes churn.</p>
                        </>
                      );
                    }}
                  </Boundary>
                )}
                {tab === 'confusion' && <ConfusionMatrix h={h} />}
                {tab === 'calibration' && <Calibration h={h} />}
                {tab === 'drift' && <DriftList h={h} />}
                {tab === 'limits' && <Limitations h={h} />}
              </div>
            </div>
          </div>
        )}
      </Boundary>
    </Section>
  );
}

/* ------------------------------------------------------------------ selected customer */
function CustomerPanel({ c, onClose }) {
  return (
    <aside aria-label={`Evidence for ${c.surname}`} className="card sheet sheet-mobile panel-enter lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="kicker">This customer</div>
          <h2 className="text-lg font-bold text-white truncate">{c.surname}</h2>
          <p className="text-xs text-gray-500 font-mono truncate">{c.accountNo} · {c.branch}</p>
        </div>
        <button onClick={onClose} className="p-1.5 -m-1.5 text-gray-500 hover:text-white rounded-md" aria-label="Close customer panel"><X size={18} /></button>
      </div>

      <div className="px-5 pb-5 space-y-5">
        <div>
          <div className="flex items-end justify-between mb-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tabular-nums text-white leading-none">{c.churnRiskScore.toFixed(0)}</span>
              <span className="text-xs text-gray-500">/ 100</span>
            </div>
            <SeverityBadge level={c.churnRiskLevel} />
          </div>
          <RiskMeter score={c.churnRiskScore} level={c.churnRiskLevel} />
          <p className="text-[11px] text-gray-500">{fmt.label(c.segment)} · {fmt.inr(c.balance)} balance · {c.complaintCount} complaint{c.complaintCount === 1 ? '' : 's'}</p>
        </div>

        <div className="rounded-lg bg-gold/[0.06] border border-gold/15 px-3 py-2.5">
          <div className="text-[11px] text-gold/80 uppercase tracking-wide font-semibold mb-0.5">Rule-based suggestion</div>
          <div className="text-sm text-white">{c.recommendedAction}</div>
        </div>

        <div>
          <h3 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Why this score</h3>
          <ul className="space-y-1.5">
            {c.churnDrivers.map((d) => (
              <li key={d} className="text-[13px] text-gray-300 flex gap-2"><span className="mt-2 w-1 h-1 rounded-full bg-risk-high shrink-0" />{d}</li>
            ))}
          </ul>
        </div>

        <ExplainBars customerId={c.customerId} />

        <div>
          <h3 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Risk trajectory</h3>
          <ScoreTrend customerId={c.customerId} />
        </div>

        <details className="group">
          <summary className="cursor-pointer text-xs text-gray-400 hover:text-gold select-none">Quick outreach (legacy trigger)</summary>
          <div className="mt-3"><OutreachPanel customerId={c.customerId} /></div>
        </details>

        <Link to={`/customers/${c.customerId}`} className="btn-primary px-4 py-2 text-sm flex items-center justify-center gap-2">
          Open full Customer 360 <ExternalLink size={14} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ page */
function SortTh({ k, sort, onToggle, children, className = '' }) {
  const on = sort.key === k;
  return (
    <th aria-sort={on ? (sort.order === 'desc' ? 'descending' : 'ascending') : 'none'} className={className}>
      <button type="button" onClick={() => onToggle(k)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-300">
        {children}
        {on && (sort.order === 'desc' ? <ArrowDown size={11} className="text-gold" /> : <ArrowUp size={11} className="text-gold" />)}
      </button>
    </th>
  );
}

export default function Pulse() {
  const [searchParams] = useSearchParams();
  const [riskLevel, setRiskLevel] = useState('');
  const [branch, setBranch] = useState(searchParams.get('branch') || '');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'risk', order: 'desc' });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [showNet, setShowNet] = useState(false);
  const dq = useDebounce(q, 250);

  useEffect(() => { setPage(0); }, [riskLevel, dq, branch, sort]);

  const stats = useApi('/customers/stats');
  const branches = useApi('/customers/branches');
  const list = useApi('/customers', {
    params: {
      riskLevel: riskLevel || undefined, q: dq || undefined, branch: branch || undefined,
      sort: sort.key, order: sort.order, limit: PAGE, offset: page * PAGE,
    },
  });
  useEvent(['risk_changed', 'balance_moved', 'model_retrained', 'outreach_triggered'], () => { list.reload(); stats.reload(); });

  const rows = list.data?.customers || [];
  const total = list.data?.total || 0;
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, order: s.order === 'desc' ? 'asc' : 'desc' } : { key, order: 'desc' }));
  const sortProps = { sort, onToggle: toggleSort };
  const select = (c) => setSelected(c);
  const selectFromNetwork = (c) => {
    setSelected(c);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('ranking-h')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  const onRowKey = (e, c) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c); } };

  return (
    <div>
      <PageHeader icon={Activity} title="Churn Pulse"
        crumbs={[{ label: 'Retention', to: '/' }, { label: 'Churn Pulse' }]}
        subtitle="A model-intelligence workspace: how the Random Forest behaves overall, who it ranks highest, and the evidence behind one customer's score."
        action={<Provenance kind="model">RandomForest · stratified hold-out</Provenance>} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mb-6">
        <div className="xl:col-span-4 reveal" style={{ '--i': 0 }}>
          <Section title="Customer risk distribution" className="h-full" hint="Every monitored customer, by current severity. Click a band to filter the ranking.">
            <Boundary state={stats} rows={4}>
              {(s) => (
                <div className="space-y-5">
                  <DistributionBar levels={s.byRiskLevel} active={riskLevel} onPick={setRiskLevel} />
                  <dl className="grid grid-cols-2 gap-4 pt-4 border-t border-white/[0.06]">
                    <div><dt className="text-[11px] uppercase tracking-wide text-gray-500">Average score</dt><dd className="text-2xl font-bold tabular-nums text-white">{s.avgRisk}</dd><dd className="text-[11px] text-gray-500">0–100, uncalibrated</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wide text-gray-500">Balance in high / critical</dt><dd className="text-2xl font-bold tabular-nums text-risk-high">{fmt.inr(s.balanceAtRisk)}</dd><dd className="text-[11px] text-gray-500">{fmt.pct(s.balanceAtRisk / s.totalBalance, 1)} of {fmt.inr(s.totalBalance)}</dd></div>
                  </dl>
                  <div className="pt-4 border-t border-white/[0.06]">
                    <h3 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Critical customers by branch</h3>
                    <Boundary state={branches} rows={4}>
                      {(b) => {
                        const top = [...b.branches].sort((x, y) => y.critical - x.critical).slice(0, 6);
                        return (
                          <>
                            <BarList unit="" labelWidth={104}
                              items={top.map((x) => ({ label: x.branch, value: x.critical, color: '#f43f5e', hint: `${x.branch}: ${x.critical} critical of ${x.customers} customers, average score ${x.avg_risk}` }))} />
                            <p className="text-[11px] text-gray-500 mt-2">Counts, not rates — larger branches naturally rank higher. Pick a branch in the filter below to drill in.</p>
                          </>
                        );
                      }}
                    </Boundary>
                  </div>
                </div>
              )}
            </Boundary>
          </Section>
        </div>
        <div className="xl:col-span-8 reveal" style={{ '--i': 1 }}><GlobalModel /></div>
      </div>

      <div className="reveal mb-6" style={{ '--i': 2 }}>
        <Section title="Retention signal network"
          hint="Where the highest-scoring customers sit across branches. Loads only when opened."
          action={(
            <button onClick={() => setShowNet((v) => !v)} aria-expanded={showNet} className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5">
              <Network size={12} aria-hidden="true" /> {showNet ? 'Hide' : 'Open network'} {showNet && <ChevronUp size={12} aria-hidden="true" />}
            </button>
          )}>
          {showNet ? <SignalNetwork selectedId={selected?.customerId} onSelect={selectFromNetwork} />
            : <p className="text-xs text-gray-500">A 3D map (with a 2D fallback) built from the live ranking: branches as hubs, customers placed by score and balance, rings for open alerts. Selecting a customer opens the same evidence panel as the table.</p>}
        </Section>
      </div>

      <section aria-labelledby="ranking-h" className="reveal" style={{ '--i': 2 }}>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 id="ranking-h" className="kicker">Customer ranking</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Highest model score first. Select a row to open that customer's evidence.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="pulse-branch">Branch</label>
            <select id="pulse-branch" className="input-field py-1.5 text-xs w-44" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {(branches.data?.branches || []).map((b) => <option key={b.branch} value={b.branch}>{b.branch} · {b.critical} critical</option>)}
            </select>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
              <label className="sr-only" htmlFor="pulse-q">Search customers</label>
              <input id="pulse-q" className="input-field pl-8 py-1.5 text-xs w-56" placeholder="Surname, account, ID…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {(riskLevel || branch || q) && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => { setRiskLevel(''); setBranch(''); setQ(''); }}>Clear filters</button>}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
          <div className="card overflow-hidden">
            <Boundary state={list} rows={6}
              isEmpty={() => rows.length === 0}
              empty={<EmptyState title="No customers match these filters" icon={UserSearch} action={<button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setRiskLevel(''); setBranch(''); setQ(''); }}>Clear filters</button>}>Try a different branch, severity or search term.</EmptyState>}>
              {() => (
                <div className={`table-wrap transition-opacity ${list.loading ? 'opacity-60' : ''}`}>
                  <table className="table-modern">
                    <caption className="sr-only">Customers ranked by churn risk</caption>
                    <thead>
                      <tr>
                        <SortTh k="surname" {...sortProps}>Customer</SortTh>
                        <th className="hidden md:table-cell">Branch</th>
                        <th className="hidden 2xl:table-cell">Segment</th>
                        <SortTh k="risk" {...sortProps}>Risk score</SortTh>
                        <SortTh k="balance" className="text-right" {...sortProps}>Balance</SortTh>
                        <th className="w-8"><span className="sr-only">Open</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.customerId} className="row-select" tabIndex={0} data-selected={selected?.customerId === c.customerId}
                          onClick={() => select(c)} onKeyDown={(e) => onRowKey(e, c)} aria-label={`${c.surname}, risk ${c.churnRiskScore.toFixed(0)}, ${c.churnRiskLevel}. Press Enter to open evidence.`}>
                          <td className="max-w-[200px]">
                            <div className="text-white font-medium truncate">{c.surname}</div>
                            <div className="text-gray-500 text-xs font-mono truncate">{c.accountNo}</div>
                          </td>
                          <td className="text-gray-400 hidden md:table-cell max-w-[170px] truncate" title={c.branch}>{c.branch}</td>
                          <td className="text-gray-400 hidden 2xl:table-cell capitalize whitespace-nowrap">{fmt.label(c.segment)}</td>
                          <td>
                            <div className="flex items-center gap-2.5">
                              <span className="w-8 text-right tabular-nums text-white font-semibold">{c.churnRiskScore.toFixed(0)}</span>
                              <span className="hidden sm:block w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${c.churnRiskScore}%`, background: { critical: '#f43f5e', high: '#f59e0b', medium: '#38bdf8', low: '#34d399' }[c.churnRiskLevel] }} /></span>
                              <SeverityBadge level={c.churnRiskLevel} />
                            </div>
                          </td>
                          <td className="text-gray-300 tabular-nums text-right whitespace-nowrap">{fmt.inr(c.balance)}</td>
                          <td className="text-gray-600"><ChevronRight size={14} aria-hidden="true" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Boundary>
            {total > 0 && (
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-white/[0.06] text-xs text-gray-500">
                <span className="tabular-nums">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {fmt.int(total)}</span>
                <div className="flex gap-1.5">
                  <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn-ghost p-1.5" aria-label="Previous page"><ChevronLeft size={14} /></button>
                  <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)} className="btn-ghost p-1.5" aria-label="Next page"><ChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </div>

          {selected ? (
            <>
              <button className="lg:hidden fixed inset-0 bg-black/55 z-30" aria-label="Close customer panel" onClick={() => setSelected(null)} />
              <CustomerPanel key={selected.customerId} c={selected} onClose={() => setSelected(null)} />
            </>
          ) : (
            <div className="hidden lg:block card lg:sticky lg:top-4">
              <EmptyState title="Select a customer" icon={UserSearch}>Their score, the reasons behind it, what would move it, and its stored history appear here.</EmptyState>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
