import { Bot, CheckCircle2, Clock, FileEdit, Inbox, Link2, MessageSquare, Send, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { client } from '../api/client';
import { RiskBadge, Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';

const STATUS_STYLES = {
  open: 'bg-risk-medium/15 text-risk-medium border-risk-medium/20',
  in_progress: 'bg-gold/15 text-gold border-gold/20',
  escalated: 'bg-risk-high/15 text-risk-high border-risk-high/20',
  resolved: 'bg-risk-low/15 text-risk-low border-risk-low/20',
};

function StatusBadge({ status }) {
  return <span className={`badge border ${STATUS_STYLES[status] || STATUS_STYLES.open}`}>{status.replace('_', ' ')}</span>;
}

function slaInfo(c) {
  if (c.status === 'resolved') return { label: 'Resolved', pct: 100, tone: 'bg-risk-low', breached: false };
  const start = new Date(c.timestamp).getTime();
  const deadline = start + c.slaHours * 3600 * 1000;
  const now = Date.now();
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

export default function Complaints() {
  const [complaints, setComplaints] = useState([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reply, setReply] = useState('');
  const [audit, setAudit] = useState(null);

  const loadList = () =>
    client.get('/complaints', { params: filter ? { status: filter } : {} }).then((res) => setComplaints(res.data.complaints));

  const loadDetail = (id) => client.get(`/complaints/${id}`).then((res) => setDetail(res.data));

  useEffect(() => { loadList(); }, [filter]);

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
      await loadDetail(selected);
      await loadList();
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status, note) =>
    run(status, async () => {
      const res = await client.patch(`/complaints/${selected}/status`, { status, note });
      if (res.data.audit) setAudit(res.data.audit);
    });

  const sendReply = () =>
    run('reply', async () => {
      await client.post(`/complaints/${selected}/messages`, { body: reply });
      setReply('');
    });

  const counts = complaints.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }), {});
  const breachedCount = complaints.filter((c) => slaInfo(c).breached).length;

  return (
    <div>
      <PageHeader
        icon={Inbox}
        title="Resolve — Complaint Inbox"
        subtitle="Persistent, customer-linked complaints with SLA tracking, a communication thread, and automatic on-chain audit on resolution."
      />

      <div className="flex items-center gap-2 mb-4">
        {['', 'open', 'in_progress', 'escalated', 'resolved'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`btn-chip ${filter === s ? 'bg-gold text-navy-dark' : 'bg-white/[0.04] text-gray-400 hover:text-gray-200 hover:bg-white/[0.08]'}`}
          >
            {s ? s.replace('_', ' ') : 'All'}{s && counts[s] ? ` · ${counts[s]}` : ''}
          </button>
        ))}
        {breachedCount > 0 && (
          <span className="ml-auto badge border bg-risk-critical/15 text-risk-critical border-risk-critical/20">
            <TriangleAlert size={12} /> {breachedCount} SLA breached
          </span>
        )}
      </div>

      <div className="grid grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
        <Card title={`Inbox (${complaints.length})`} noPad className="max-h-[72vh] overflow-y-auto">
          <div className="px-2 pb-2">
            {complaints.map((c) => {
              const sla = slaInfo(c);
              return (
                <button
                  key={c.id}
                  onClick={() => select(c)}
                  className={`block w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors ${
                    selected === c.id ? 'bg-gold/[0.10] border border-gold/20' : 'hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
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
              );
            })}
          </div>
        </Card>

        <Card title="Case detail">
          {!detail ? (
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
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                  <Link to={`/customers/${detail.customerId}`} className="flex items-center gap-1 text-gold hover:underline">
                    <Link2 size={12} /> {detail.customerName} · {detail.accountNo}
                  </Link>
                  <span>&middot;</span>
                  <span className="flex items-center gap-1"><Clock size={12} /> SLA {detail.slaHours}h · {slaInfo(detail).label}</span>
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
          )}
        </Card>
      </div>
    </div>
  );
}
