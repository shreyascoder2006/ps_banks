import React, { useState } from 'react';
import { client } from '../api/client';
import Card from '../components/Card';
import { useAuth } from '../auth/AuthContext';

export default function Blockchain() {
  const { role } = useAuth();
  const [description, setDescription] = useState('');
  const [payload, setPayload] = useState('');
  const [result, setResult] = useState(null);
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);

  const store = async () => {
    setBusy(true);
    try {
      const res = await client.post('/blockchain/audit', {
        record_type: 'churn_intervention',
        description,
        payload,
      });
      setResult(res.data);
    } finally {
      setBusy(false);
    }
  };

  const fetchLatest = async () => {
    const res = await client.get('/blockchain/audit/latest');
    setLatest(res.data);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Audit Trail (Demo Ganache Blockchain)</h1>
      <p className="text-xs text-gray-500">
        Records a SHA-256 hash of an audit-worthy action (retention call made, complaint resolved, forecast snapshot)
        immutably on a local Ganache chain. RPC URL / contract / private key are server-side only — never sent from this page.
      </p>

      {role === 'admin' ? (
        <Card title="Store new audit record (admin only)">
          <input
            className="w-full p-2 rounded bg-navy border border-gold/20 text-white text-sm mb-2"
            placeholder="Description e.g. 'Retention call made to CUST-15634602'"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <textarea
            className="w-full p-2 rounded bg-navy border border-gold/20 text-white text-sm mb-2"
            placeholder="Payload text to hash (e.g. call notes, resolution summary)"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
          <button onClick={store} disabled={busy} className="bg-gold text-navy-dark px-4 py-1 rounded text-sm font-semibold disabled:opacity-50">
            Store on chain
          </button>
          {result && (
            <pre className="text-xs text-gray-300 mt-3 whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
          )}
        </Card>
      ) : (
        <Card><p className="text-gray-400 text-sm">Storing audit records requires an admin login.</p></Card>
      )}

      <Card title="Latest on-chain record">
        <button onClick={fetchLatest} className="bg-white/10 text-white px-4 py-1 rounded text-sm mb-3">Refresh</button>
        {latest && <pre className="text-xs text-gray-300 whitespace-pre-wrap">{JSON.stringify(latest, null, 2)}</pre>}
      </Card>
    </div>
  );
}
