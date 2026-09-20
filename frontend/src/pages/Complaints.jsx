import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import Card from '../components/Card';

const SEVERITY_COLORS = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#22c55e' };

export default function Complaints() {
  const [complaints, setComplaints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get('/complaints').then((res) => setComplaints(res.data.complaints));
  }, []);

  const select = (c) => {
    setSelected(c);
    setAnalysis(null);
    setDraft(null);
  };

  const runAnalysis = async () => {
    setBusy(true);
    try {
      const res = await client.post(`/complaints/${selected.id}/analyze`);
      setAnalysis(res.data);
    } finally {
      setBusy(false);
    }
  };

  const runDraft = async () => {
    setBusy(true);
    try {
      const res = await client.post(`/complaints/${selected.id}/draft-response`);
      setDraft(res.data);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Resolve — Complaint Inbox</h1>
      <p className="text-xs text-gray-500">
        Complaint narratives are real CFPB (US) consumer complaints, relabelled with Indian names for this demo — see LIMITATIONS.md.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <Card title={`Inbox (${complaints.length})`} className="col-span-1 max-h-[70vh] overflow-y-auto">
          {complaints.map((c) => (
            <button
              key={c.id}
              onClick={() => select(c)}
              className={`block w-full text-left p-2 rounded mb-1 text-sm ${selected?.id === c.id ? 'bg-gold/20' : 'hover:bg-white/5'}`}
            >
              <div className="flex justify-between">
                <span className="text-white">{c.customerName}</span>
                <span style={{ color: SEVERITY_COLORS[c.severity] }} className="text-xs font-semibold">{c.severity}</span>
              </div>
              <div className="text-gray-400 text-xs truncate">{c.subject}</div>
            </button>
          ))}
        </Card>

        <Card title="Detail" className="col-span-2">
          {!selected ? (
            <p className="text-gray-400">Select a complaint.</p>
          ) : (
            <div className="space-y-3">
              <h3 className="text-white font-semibold">{selected.subject}</h3>
              <p className="text-sm text-gray-300">{selected.body}</p>
              <div className="text-xs text-gray-500">Channel: {selected.channel} · SLA: {selected.slaHours}h · Category: {selected.category}</div>

              <div className="flex gap-2">
                <button onClick={runAnalysis} disabled={busy} className="bg-gold text-navy-dark text-sm px-3 py-1 rounded font-semibold disabled:opacity-50">
                  Run AI analysis
                </button>
                <button onClick={runDraft} disabled={busy} className="bg-white/10 text-white text-sm px-3 py-1 rounded disabled:opacity-50">
                  Draft response
                </button>
              </div>

              {analysis && (
                <div className="card p-3 text-sm">
                  <p className="text-gold text-xs uppercase mb-1">AI Analysis ({analysis.source})</p>
                  <p>{analysis.summary}</p>
                  <p className="text-gray-400 mt-1">Regulatory risk: {analysis.regulatoryRisk} · Recommended: {analysis.recommendedAction}</p>
                </div>
              )}
              {draft && (
                <div className="card p-3 text-sm">
                  <p className="text-gold text-xs uppercase mb-1">Draft response ({draft.source})</p>
                  <p className="whitespace-pre-wrap">{draft.draft}</p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
