import { Hash, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import React, { useState } from 'react';
import { client } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';

function StatusPill({ status }) {
  const map = {
    stored: 'bg-risk-low/15 text-risk-low border-risk-low/20',
    ok: 'bg-risk-low/15 text-risk-low border-risk-low/20',
    not_configured: 'bg-gray-500/15 text-gray-400 border-gray-500/20',
    error: 'bg-risk-critical/15 text-risk-critical border-risk-critical/20',
    failed: 'bg-risk-critical/15 text-risk-critical border-risk-critical/20',
  };
  return <span className={`badge border ${map[status] || map.not_configured}`}>{status}</span>;
}

export default function Blockchain() {
  const { role } = useAuth();
  const [description, setDescription] = useState('');
  const [payload, setPayload] = useState('');
  const [result, setResult] = useState(null);
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fetchingLatest, setFetchingLatest] = useState(false);

  const store = async () => {
    setBusy(true);
    try {
      const res = await client.post('/blockchain/audit', { record_type: 'churn_intervention', description, payload });
      setResult(res.data);
    } finally {
      setBusy(false);
    }
  };

  const fetchLatest = async () => {
    setFetchingLatest(true);
    try {
      const res = await client.get('/blockchain/audit/latest');
      setLatest(res.data);
    } finally {
      setFetchingLatest(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon={ShieldCheck}
        title="Audit Trail"
        subtitle="Demo Ganache blockchain — hashes an audit-worthy action (retention call, complaint resolution, forecast snapshot) immutably. RPC URL / contract / private key are server-side only."
      />

      {role === 'admin' ? (
        <Card title="Store new audit record" action={<span className="badge bg-gold/15 text-gold"><Lock size={11} /> Admin only</span>} className="mb-6">
          <div className="space-y-3">
            <input
              className="input-field py-2.5"
              placeholder="Description e.g. 'Retention call made to CUST-15634602'"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <textarea
              className="input-field py-2.5 min-h-[90px] resize-y"
              placeholder="Payload text to hash (e.g. call notes, resolution summary)"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
            <button onClick={store} disabled={busy || !description.trim()} className="btn-primary px-5 py-2 text-sm flex items-center gap-1.5">
              {busy ? <Spinner size={13} className="text-navy-dark" /> : <Hash size={14} />}
              Store on chain
            </button>
          </div>
          {result && (
            <div className="fade-in mt-4 rounded-lg bg-white/[0.03] border border-white/[0.06] p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="kicker">Result</span>
                <StatusPill status={result.status} />
              </div>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </Card>
      ) : (
        <Card className="mb-6">
          <div className="flex items-center gap-3 text-gray-400 text-sm">
            <Lock size={16} className="text-gray-500" />
            Storing audit records requires an admin login.
          </div>
        </Card>
      )}

      <Card
        title="Latest on-chain record"
        action={
          <button onClick={fetchLatest} disabled={fetchingLatest} className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5">
            {fetchingLatest ? <Spinner size={12} /> : <RefreshCw size={12} />}
            Refresh
          </button>
        }
      >
        {!latest ? (
          <p className="text-sm text-gray-500">Click refresh to check the chain.</p>
        ) : (
          <div className="fade-in">
            <StatusPill status={latest.status} />
            <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed mt-3">{JSON.stringify(latest, null, 2)}</pre>
          </div>
        )}
      </Card>
    </div>
  );
}
