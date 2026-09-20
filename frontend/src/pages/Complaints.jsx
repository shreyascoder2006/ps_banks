import { BarChart3, Bot, CheckCircle2, CheckSquare, Clock, Copy, FileEdit, Inbox, KanbanSquare, Link2, List, MessageSquare, Plus, Search, Send, ShieldCheck, Sparkles, Square, TriangleAlert, UserRound, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { client } from '../api/client';
import { RiskBadge, Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { useInterval, useNow } from '../lib/hooks';

const STATUSES = ['open', 'in_progress', 'escalated', 'resolved'];
const AGENTS = ['agent', 'admin', 'rm-team', 'fraud-desk', 'ombudsman-cell'];

const STATUS_STYLES = {
  open: 'bg-risk-medium/15 text-risk-medium border-risk-medium/20',
  in_progress: 'bg-gold/15 text-gold border-gold/20',
  escalated: 'bg-risk-high/15 text-risk-high border-risk-high/20',
  resolved: 'bg-risk-low/15 text-risk-low border-risk-low/20',
};

function StatusBadge({ status }) {
  return <span className={`badge border ${STATUS_STYLES[status] || STATUS_STYLES.open}`}>{status.replace('_', ' ')}</span>;
}

function slaInfo(c, now = Date.now()) {
  if (c.status === 'resolved') return { label: 'Resolved', pct: 100, tone: 'bg-risk-low', breached: false };
  const start = new Date(c.timestamp).getTime();
  const deadline = start + c.slaHours * 3600 * 1000;
  const pct = Math.min(100, Math.max(0, ((now - start) / (deadline - start)) * 100));
  const remainingMs = deadline - now;
  const breached = remainingMs < 0;
  const abs = Math.abs(remainingMs);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const label = breached ? `Breached by ${h}h ${m}m` : `${h}h ${m}m remaining`;
  const tone = breached ? 'bg-risk-critical' : pct > 75 ? 'bg-risk-high' : pct > 50 ? 'bg-gold' : 'bg-risk-medium';
  return { label, pct, tone, breached };
}

function SourcePill({ source }) {
  return (
    <span className={`badge ${source === 'groq' ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>{source}</span>
  );
}

const COLUMN_META = {
  open: { label: 'Open', accent: 'border-risk-medium/40' },
  in_progress: { label: 'In progress', accent: 'border-gold/40' },
  escalated: { label: 'Escalated', accent: 'border-risk-high/40' },
  resolved: { label: 'Resolved', accent: 'border-risk-low/40' },
};

function Board({ complaints, now, onMove, onOpen, selectedId, movingId }) {
  const [over, setOver] = useState(null);
  const byStatus = useMemo(
    () => STATUSES.reduce((acc, s) => ({ ...acc, [s]: complaints.filter((c) => c.status === s) }), {}),
    [complaints],
  );

  return (
    <div className="grid grid-cols-4 gap-3">
      {STATUSES.map((status) => (
        <div
          key={status}
          onDragOver={(e) => { e.preventDefault(); setOver(status); }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/complaint-id');
            const from = e.dataTransfer.getData('text/from-status');
            setOver(null);
            if (id && from !== status) onMove(id, status);
          }}
          className={`card border-t-2 ${COLUMN_META[status].accent} min-h-[60vh] transition-colors ${over === status ? 'bg-gold/[0.06]' : ''}`}
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <span className="kicker">{COLUMN_META[status].label}</span>
            <span className="text-xs text-gray-500 tabular-nums">{byStatus[status].length}</span>
          </div>
          <div className="px-2 pb-2 space-y-2">
            {byStatus[status].map((c) => {
              const sla = slaInfo(c, now);
              return (
                <div
                  key={c.id}
                  draggable={status !== 'resolved'}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/complaint-id', c.id);
                    e.dataTransfer.setData('text/from-status', status);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => onOpen(c)}
                  className={`rounded-lg border p-2.5 cursor-grab active:cursor-grabbing transition-all ${
                    selectedId === c.id ? 'bg-gold/[0.10] border-gold/30' : 'bg-white/[0.03] border-white/[0.06] hover:border-white/20'
                  } ${movingId === c.id ? 'opacity-40' : ''} ${sla.breached ? 'ring-1 ring-risk-critical/40' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-white text-sm font-medium truncate">{c.customerName}</span>
                    <RiskBadge level={c.severity}>{c.severity}</RiskBadge>
                  </div>
                  <div className="text-gray-400 text-xs truncate">{c.subject}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div className={`h-full ${sla.tone}`} style={{ width: `${sla.pct}%` }} />
                    </div>
                    <span className={`text-[10px] whitespace-nowrap ${sla.breached ? 'text-risk-critical' : 'text-gray-500'}`}>{sla.label}</span>
                  </div>
                  {c.assignee && <div className="text-[10px] text-gray-500 mt-1.5 flex items-center gap-1"><UserRound size={10} /> {c.assignee}</div>}
                </div>
              );
            })}
            {byStatus[status].length === 0 && (
              <div className="text-xs text-gray-600 text-center py-6 border border-dashed border-white/[0.06] rounded-lg">Drop here</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Complaints() {
  const [complaints, setComplaints] = useState([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reply, setReply] = useState('');
  const [audit, setAudit] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ customer_id: '', subject: '', body: '', channel: 'portal' });
  const [newError, setNewError] = useState('');
  const [view, setView] = useState('inbox');
  const [q, setQ] = useState('');
  const [checked, setChecked] = useState(() => new Set());
  const [movingId, setMovingId] = useState(null);
  const toast = useToast();
  const now = useNow(15000);

  const loadList = () =>
    client.get('/complaints', { params: filter && view === 'inbox' ? { status: filter } : {} }).then((res) => setComplaints(res.data.complaints));

  const loadDetail = (id) => client.get(`/complaints/${id}`).then((res) => setDetail(res.data));

  useEffect(() => { loadList(); }, [filter, view]);
  useInterval(loadList, 30000);

  const select = (c) => {
    setSelected(c.id);
    setAudit(null);
    setReply('');
    loadDetail(c.id);
  };

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
      if (selected) await loadDetail(selected);
      await loadList();
    } catch (err) {
      toast(err.response?.data?.detail || 'Action failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status, note) =>
    run(status, async () => {
      const res = await client.patch(`/complaints/${selected}/status`, { status, note });
      if (res.data.audit) setAudit(res.data.audit);
      toast(`${selected} → ${status.replace('_', ' ')}${res.data.audit ? ` · audit ${res.data.audit.status}` : ''}`, status === 'resolved' ? 'success' : 'info');
    });

  const moveCard = async (id, status) => {
    setMovingId(id);
    try {
      const res = await client.patch(`/complaints/${id}/status`, { status, note: 'Moved on board' });
      toast(`${id} → ${status.replace('_', ' ')}${res.data.audit ? ` · audit ${res.data.audit.status}` : ''}`, status === 'resolved' ? 'success' : 'info');
      if (selected === id) { setAudit(res.data.audit); await loadDetail(id); }
      await loadList();
    } catch (err) {
      toast(err.response?.data?.detail || 'Move failed', 'error');
    } finally {
      setMovingId(null);
    }
  };

  const assign = (assignee) =>
    run('assign', async () => {
      await client.patch(`/complaints/${selected}/assign`, { assignee });
      toast(`${selected} assigned to ${assignee}`, 'info');
    });

  const bulk = async (kind, value) => {
    const ids = [...checked];
    setBusy('bulk');
    try {
      await Promise.all(ids.map((id) =>
        kind === 'assign'
          ? client.patch(`/complaints/${id}/assign`, { assignee: value })
          : client.patch(`/complaints/${id}/status`, { status: value, note: 'Bulk action' }),
      ));
      toast(`${ids.length} complaint(s) ${kind === 'assign' ? `assigned to ${value}` : `→ ${value.replace('_', ' ')}`}`, 'success');
      setChecked(new Set());
      await loadList();
      if (selected) await loadDetail(selected);
    } catch (err) {
      toast('Bulk action failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleChecked = (id) =>
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const sendReply = () =>
    run('reply', async () => {
      await client.post(`/complaints/${selected}/messages`, { body: reply });
      setReply('');
      toast('Reply sent to customer', 'success');
    });

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return complaints;
    return complaints.filter((c) =>
      [c.customerName, c.subject, c.id, c.category, c.accountNo, c.assignee].some((v) => v && String(v).toLowerCase().includes(needle)),
    );
  }, [complaints, q]);

  const counts = complaints.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }), {});
  const breachedCount = complaints.filter((c) => slaInfo(c, now).breached).length;

  const submitNew = async (e) => {
    e.preventDefault();
    setBusy('new');
    setNewError('');
    try {
      const res = await client.post('/complaints', { ...newForm, customer_id: Number(newForm.customer_id) });
      setShowNew(false);
      setNewForm({ customer_id: '', subject: '', body: '', channel: 'portal' });
      await loadList();
      select(res.data.complaint);
    } catch (err) {
      setNewError(err.response?.data?.detail || 'Failed to log complaint');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        icon={Inbox}
        title="Resolve — Complaint Inbox"
        subtitle="Persistent, customer-linked complaints with SLA tracking, a communication thread, and automatic on-chain audit on resolution."
        action={
          <div className="flex gap-2">
            <Link to="/complaints/insights" className="btn-ghost px-3 py-2 text-sm flex items-center gap-1.5"><BarChart3 size={14} /> Insights</Link>
            <button onClick={() => setShowNew(true)} className="btn-primary px-3 py-2 text-sm flex items-center gap-1.5"><Plus size={14} /> Log complaint</button>
          </div>
        }
      />

      {showNew && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 fade-in" onClick={() => setShowNew(false)}>
          <form onSubmit={submitNew} className="card p-6 w-[520px] shadow-glow space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold">Log a new complaint</h2>
              <button type="button" onClick={() => setShowNew(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-xs text-gray-500">Severity and category are auto-triaged from the text (and refined by AI when a Groq key is configured). Related complaints are detected on save.</p>
            <div className="grid grid-cols-2 gap-3">
              <input className="input-field py-2" placeholder="Customer ID e.g. 15634602" value={newForm.customer_id} onChange={(e) => setNewForm({ ...newForm, customer_id: e.target.value })} required />
              <select className="input-field py-2" value={newForm.channel} onChange={(e) => setNewForm({ ...newForm, channel: e.target.value })}>
                {['portal', 'email', 'whatsapp', 'branch', 'ivr'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <input className="input-field py-2" placeholder="Subject" value={newForm.subject} onChange={(e) => setNewForm({ ...newForm, subject: e.target.value })} required />
            <textarea className="input-field py-2 min-h-[110px] resize-y" placeholder="Complaint text as received from the customer" value={newForm.body} onChange={(e) => setNewForm({ ...newForm, body: e.target.value })} required />
            {newError && <div className="px-3 py-2 rounded-lg bg-risk-critical/10 border border-risk-critical/20 text-red-300 text-xs">{newError}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowNew(false)} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
              <button type="submit" disabled={busy === 'new'} className="btn-primary px-4 py-2 text-sm flex items-center gap-1.5">
                {busy === 'new' ? <Spinner size={13} className="text-navy-dark" /> : <Plus size={14} />} Log & triage
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          <button onClick={() => setView('inbox')} className={`px-3 py-1.5 text-xs flex items-center gap-1.5 ${view === 'inbox' ? 'bg-gold text-navy-dark' : 'text-gray-400 hover:bg-white/[0.05]'}`}><List size={13} /> Inbox</button>
          <button onClick={() => setView('board')} className={`px-3 py-1.5 text-xs flex items-center gap-1.5 ${view === 'board' ? 'bg-gold text-navy-dark' : 'text-gray-400 hover:bg-white/[0.05]'}`}><KanbanSquare size={13} /> Board</button>
        </div>
        {view === 'inbox' && ['', ...STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`btn-chip ${filter === s ? 'bg-gold text-navy-dark' : 'bg-white/[0.04] text-gray-400 hover:text-gray-200 hover:bg-white/[0.08]'}`}
          >
            {s ? s.replace('_', ' ') : 'All'}{s && counts[s] ? ` · ${counts[s]}` : ''}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-8 py-1.5 text-xs w-56" placeholder="Search name, subject, ID, assignee…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {breachedCount > 0 && (
          <span className="badge border bg-risk-critical/15 text-risk-critical border-risk-critical/20">
            <TriangleAlert size={12} /> {breachedCount} SLA breached
          </span>
        )}
      </div>

      {checked.size > 0 && (
        <div className="fade-in mb-4 card px-4 py-2.5 flex items-center gap-3 text-sm border-gold/20">
          <CheckSquare size={15} className="text-gold" />
          <span className="text-white">{checked.size} selected</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400 text-xs">Assign to</span>
          {AGENTS.map((a) => <button key={a} onClick={() => bulk('assign', a)} disabled={busy === 'bulk'} className="btn-chip bg-white/[0.05] text-gray-300 hover:bg-white/[0.1]">{a}</button>)}
          <span className="text-gray-600">|</span>
          <button onClick={() => bulk('status', 'escalated')} disabled={busy === 'bulk'} className="btn-chip bg-risk-high/15 text-risk-high">Escalate</button>
          <button onClick={() => bulk('status', 'resolved')} disabled={busy === 'bulk'} className="btn-chip bg-risk-low/15 text-risk-low">Resolve</button>
          <button onClick={() => setChecked(new Set())} className="ml-auto text-xs text-gray-500 hover:text-white">Clear</button>
        </div>
      )}

      {view === 'board' ? (
        <div className="space-y-4">
          <Board complaints={visible} now={now} onMove={moveCard} onOpen={select} selectedId={selected} movingId={movingId} />
          {detail && (
            <Card title="Case detail" action={<button onClick={() => { setSelected(null); setDetail(null); }} className="text-gray-500 hover:text-white"><X size={16} /></button>}>
              {renderDetail()}
            </Card>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
        <Card title={`Inbox (${visible.length})`} noPad className="max-h-[72vh] overflow-y-auto">
          <div className="px-2 pb-2">
            {visible.length === 0 && <p className="text-xs text-gray-500 text-center py-8">No complaints match.</p>}
            {visible.map((c) => {
              const sla = slaInfo(c, now);
              const isChecked = checked.has(c.id);
              return (
                <div
                  key={c.id}
                  className={`flex items-start gap-2 px-2 py-2.5 rounded-lg mb-1 transition-colors ${
                    selected === c.id ? 'bg-gold/[0.10] border border-gold/20' : 'hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <button onClick={() => toggleChecked(c.id)} className={`mt-0.5 shrink-0 ${isChecked ? 'text-gold' : 'text-gray-600 hover:text-gray-400'}`}>
                    {isChecked ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                  <button onClick={() => select(c)} className="flex-1 min-w-0 text-left">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-white text-sm font-medium truncate">{c.customerName}</span>
                      <RiskBadge level={c.severity}>{c.severity}</RiskBadge>
                    </div>
                    <div className="text-gray-500 text-xs truncate mt-0.5">{c.subject}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className={`h-full ${sla.tone}`} style={{ width: `${sla.pct}%` }} />
                      </div>
                      <span className={`text-[10px] ${sla.breached ? 'text-risk-critical' : 'text-gray-500'}`}>{sla.label}</span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Case detail">
          {renderDetail()}
        </Card>
      </div>
      )}
    </div>
  );

  function renderDetail() {
    return !detail ? (
            <div className="text-center py-16 text-gray-500">
              <Inbox size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Select a complaint from the inbox.</p>
            </div>
          ) : (
            <div className="space-y-4 fade-in">
              <div>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <h3 className="text-white font-semibold">{detail.subject}</h3>
                  <RiskBadge level={detail.severity}>{detail.severity}</RiskBadge>
                  <StatusBadge status={detail.status} />
                  <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
                    <UserRound size={12} />
                    <select className="input-field py-1 text-xs w-36" value={detail.assignee || ''} onChange={(e) => e.target.value && assign(e.target.value)} disabled={!!busy}>
                      <option value="">Unassigned</option>
                      {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                  <Link to={`/customers/${detail.customerId}`} className="flex items-center gap-1 text-gold hover:underline">
                    <Link2 size={12} /> {detail.customerName} · {detail.accountNo}
                  </Link>
                  <span>&middot;</span>
                  <span className="flex items-center gap-1"><Clock size={12} /> SLA {detail.slaHours}h · {slaInfo(detail, now).label}</span>
                  <span>&middot;</span>
                  <span className="capitalize">{detail.channel}</span>
                  <span>&middot;</span>
                  <span>{detail.category}</span>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{detail.body}</p>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button onClick={() => run('analyze', () => client.post(`/complaints/${selected}/analyze`))} disabled={!!busy} className="btn-primary px-4 py-2 text-sm flex items-center gap-1.5">
                  {busy === 'analyze' ? <Spinner size={13} className="text-navy-dark" /> : <Sparkles size={14} />} Run AI analysis
                </button>
                <button onClick={() => run('draft', () => client.post(`/complaints/${selected}/draft-response`))} disabled={!!busy} className="btn-ghost px-4 py-2 text-sm flex items-center gap-1.5">
                  {busy === 'draft' ? <Spinner size={13} /> : <FileEdit size={14} />} Draft response
                </button>
                <div className="ml-auto flex gap-2">
                  {detail.status !== 'escalated' && detail.status !== 'resolved' && (
                    <button onClick={() => setStatus('escalated', 'Escalated by agent')} disabled={!!busy} className="btn-ghost px-3 py-2 text-sm flex items-center gap-1.5 text-risk-high">
                      <TriangleAlert size={14} /> Escalate
                    </button>
                  )}
                  {detail.status !== 'resolved' && (
                    <button onClick={() => setStatus('resolved')} disabled={!!busy} className="btn-ghost px-3 py-2 text-sm flex items-center gap-1.5 text-risk-low">
                      {busy === 'resolved' ? <Spinner size={13} /> : <CheckCircle2 size={14} />} Mark resolved
                    </button>
                  )}
                </div>
              </div>

              {audit && (
                <div className={`fade-in rounded-lg border p-3 text-xs flex items-start gap-2 ${audit.status === 'stored' ? 'bg-risk-low/[0.06] border-risk-low/20' : 'bg-white/[0.03] border-white/[0.06]'}`}>
                  <ShieldCheck size={14} className={audit.status === 'stored' ? 'text-risk-low mt-0.5' : 'text-gray-500 mt-0.5'} />
                  <div className="min-w-0">
                    <div className="text-gray-200 font-medium">Audit trail: {audit.status}</div>
                    {audit.tx_hash && <div className="text-gray-500 font-mono truncate">tx {audit.tx_hash} · block {audit.block_number}</div>}
                    {audit.detail && <div className="text-gray-500">{audit.detail}</div>}
                  </div>
                </div>
              )}

              {detail.aiAnalysis && (
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot size={14} className="text-gold" />
                    <span className="kicker">AI analysis</span>
                    <SourcePill source={detail.aiAnalysis.source} />
                  </div>
                  <p className="text-sm text-gray-200">{detail.aiAnalysis.summary}</p>
                  {detail.aiAnalysis.keyIssues?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {detail.aiAnalysis.keyIssues.map((k, i) => <span key={i} className="badge bg-white/[0.06] text-gray-300">{k}</span>)}
                    </div>
                  )}
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Regulatory risk: <span className="text-gray-300">{detail.aiAnalysis.regulatoryRisk}</span></span>
                    <span>Recommended: <span className="text-gray-300">{detail.aiAnalysis.recommendedAction}</span></span>
                  </div>
                </div>
              )}

              {detail.related?.length > 0 && (
                <div className="rounded-lg bg-risk-high/[0.05] border border-risk-high/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Copy size={14} className="text-risk-high" />
                    <span className="kicker">Possible duplicates / related</span>
                    <span className="text-[11px] text-gray-500">TF-IDF similarity on complaint text</span>
                  </div>
                  <div className="space-y-1.5">
                    {detail.related.map((r) => (
                      <button key={r.id} onClick={() => select(r)} className="w-full text-left flex items-center gap-3 text-sm hover:bg-white/[0.04] rounded-md px-2 py-1.5 transition-colors">
                        <span className="font-mono text-xs text-gray-500">{r.id}</span>
                        <span className="text-gray-200 flex-1 truncate">{r.subject}</span>
                        {r.sameCustomer && <span className="badge bg-risk-high/15 text-risk-high">same customer</span>}
                        <span className="text-gray-500 text-xs capitalize">{r.status.replace('_', ' ')}</span>
                        <span className="text-gold text-xs tabular-nums">{(r.similarity * 100).toFixed(0)}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {detail.draftResponse && (
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <FileEdit size={14} className="text-gold" />
                    <span className="kicker">Draft response</span>
                    <SourcePill source={detail.draftResponse.source} />
                    <button onClick={() => setReply(detail.draftResponse.draft)} className="ml-auto text-xs text-gold hover:underline">Use as reply</button>
                  </div>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.draftResponse.draft}</p>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare size={14} className="text-gold" />
                  <span className="kicker">Communication history</span>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {detail.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`text-sm px-3 py-2 rounded-lg ${
                        m.author === 'customer' ? 'bg-white/[0.04] text-gray-200'
                          : m.author === 'agent' ? 'bg-gold/[0.10] text-white ml-8'
                          : 'text-gray-500 text-xs italic'
                      }`}
                    >
                      {m.author !== 'system' && <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">{m.author} · {new Date(m.createdAt).toLocaleString()}</div>}
                      {m.body}
                    </div>
                  ))}
                </div>
                {detail.status !== 'resolved' && (
                  <form onSubmit={(e) => { e.preventDefault(); if (reply.trim()) sendReply(); }} className="flex gap-2 mt-3">
                    <textarea className="input-field py-2 min-h-[60px] resize-y" placeholder="Reply to customer..." value={reply} onChange={(e) => setReply(e.target.value)} />
                    <button type="submit" disabled={!!busy || !reply.trim()} className="btn-primary px-4 flex items-center gap-1.5 text-sm self-end">
                      <Send size={14} /> Send
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
  }
}
