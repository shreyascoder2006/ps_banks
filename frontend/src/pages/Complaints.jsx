import { Bot, Clock, FileEdit, Inbox, Sparkles } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import { RiskBadge, Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';

export default function Complaints() {
  const [complaints, setComplaints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busyAction, setBusyAction] = useState(null);

  useEffect(() => {
    client.get('/complaints').then((res) => setComplaints(res.data.complaints));
  }, []);

  const select = (c) => {
    setSelected(c);
    setAnalysis(null);
    setDraft(null);
  };

  const runAnalysis = async () => {
    setBusyAction('analyze');
    try {
      const res = await client.post(`/complaints/${selected.id}/analyze`);
      setAnalysis(res.data);
    } finally {
      setBusyAction(null);
    }
  };

  const runDraft = async () => {
    setBusyAction('draft');
    try {
      const res = await client.post(`/complaints/${selected.id}/draft-response`);
      setDraft(res.data);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div>
      <PageHeader
        icon={Inbox}
        title="Resolve — Complaint Inbox"
        subtitle="Complaint narratives are real CFPB (US) consumer complaints, relabelled with Indian names for this demo — see LIMITATIONS.md."
      />

      <div className="grid grid-cols-[320px_1fr] gap-4 items-start">
        <Card title={`Inbox (${complaints.length})`} noPad className="max-h-[70vh] overflow-y-auto">
          <div className="px-2 pb-2">
            {complaints.map((c) => (
              <button
                key={c.id}
                onClick={() => select(c)}
                className={`block w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors ${
                  selected?.id === c.id ? 'bg-gold/[0.10] border border-gold/20' : 'hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <div className="flex justify-between items-center gap-2">
                  <span className="text-white text-sm font-medium truncate">{c.customerName}</span>
                  <RiskBadge level={c.severity}>{c.severity}</RiskBadge>
                </div>
                <div className="text-gray-500 text-xs truncate mt-0.5">{c.subject}</div>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Detail">
          {!selected ? (
            <div className="text-center py-16 text-gray-500">
              <Inbox size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Select a complaint from the inbox.</p>
            </div>
          ) : (
            <div className="space-y-4 fade-in">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-white font-semibold">{selected.subject}</h3>
                  <RiskBadge level={selected.severity}>{selected.severity}</RiskBadge>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{selected.body}</p>
                <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Clock size={12} /> SLA {selected.slaHours}h</span>
                  <span>&middot;</span>
                  <span className="capitalize">{selected.channel}</span>
                  <span>&middot;</span>
                  <span>{selected.category}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={runAnalysis} disabled={!!busyAction} className="btn-primary px-4 py-2 text-sm flex items-center gap-1.5">
                  {busyAction === 'analyze' ? <Spinner size={13} className="text-navy-dark" /> : <Sparkles size={14} />}
                  Run AI analysis
                </button>
                <button onClick={runDraft} disabled={!!busyAction} className="btn-ghost px-4 py-2 text-sm flex items-center gap-1.5">
                  {busyAction === 'draft' ? <Spinner size={13} /> : <FileEdit size={14} />}
                  Draft response
                </button>
              </div>

              {analysis && (
                <div className="fade-in rounded-lg bg-white/[0.03] border border-white/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot size={14} className="text-gold" />
                    <span className="kicker">AI analysis</span>
                    <span className={`badge ${analysis.source === 'groq' ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>
                      {analysis.source}
                    </span>
                  </div>
                  <p className="text-sm text-gray-200">{analysis.summary}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Regulatory risk: <span className="text-gray-300">{analysis.regulatoryRisk}</span></span>
                    <span>Recommended: <span className="text-gray-300">{analysis.recommendedAction}</span></span>
                  </div>
                </div>
              )}
              {draft && (
                <div className="fade-in rounded-lg bg-white/[0.03] border border-white/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <FileEdit size={14} className="text-gold" />
                    <span className="kicker">Draft response</span>
                    <span className={`badge ${draft.source === 'groq' ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>
                      {draft.source}
                    </span>
                  </div>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{draft.draft}</p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
