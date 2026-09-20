import { Mail, MessageSquare, Phone, Send, ShieldCheck, Smartphone, Sparkles, UserRound } from 'lucide-react';
import React, { useState } from 'react';
import { client } from '../api/client';
import { Spinner } from './Badge';

const CHANNEL_ICONS = { rm_visit: UserRound, call: Phone, email: Mail, sms: MessageSquare, in_app: Smartphone };
const CHANNELS = [
  { value: 'rm_visit', label: 'RM visit' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'in_app', label: 'In-app' },
];

export default function OutreachPanel({ customerId, onTriggered }) {
  const [rec, setRec] = useState(null);
  const [channel, setChannel] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);

  const recommend = async () => {
    setBusy('recommend');
    setResult(null);
    try {
      const res = await client.get(`/outreach/recommend/${customerId}`);
      setRec(res.data);
      setChannel(res.data.channel);
      setMessage(res.data.message);
    } finally {
      setBusy(null);
    }
  };

  const trigger = async () => {
    setBusy('trigger');
    try {
      const res = await client.post('/outreach/trigger', { customer_id: customerId, channel, message });
      setResult(res.data);
      onTriggered?.(res.data);
    } finally {
      setBusy(null);
    }
  };

  if (!rec) {
    return (
      <button onClick={recommend} disabled={!!busy} className="btn-primary w-full py-2 text-sm flex items-center justify-center gap-1.5">
        {busy === 'recommend' ? <Spinner size={13} className="text-navy-dark" /> : <Sparkles size={14} />}
        Recommend outreach
      </button>
    );
  }

  const Icon = CHANNEL_ICONS[channel] || Phone;

  return (
    <div className="space-y-3 fade-in">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Why</div>
        <ul className="space-y-1">
          {rec.reasons.map((r, i) => (
            <li key={i} className="text-xs text-gray-300 flex gap-1.5"><span className="text-gold">›</span>{r}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Channel <span className="text-gold normal-case">(recommended: {rec.channelLabel})</span></div>
        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map((c) => (
            <button
              key={c.value}
              onClick={() => setChannel(c.value)}
              className={`btn-chip ${channel === c.value ? 'bg-gold text-navy-dark' : 'bg-white/[0.04] text-gray-400 hover:text-gray-200'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Message</span>
          <span className={`badge ${rec.messageSource === 'groq' ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>{rec.messageSource}</span>
        </div>
        <textarea className="input-field text-xs py-2 min-h-[110px] resize-y leading-relaxed" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="text-[11px] text-gray-500 mt-1">Offer: {rec.offerType}</div>
      </div>

      {!result ? (
        <button onClick={trigger} disabled={!!busy} className="btn-primary w-full py-2 text-sm flex items-center justify-center gap-1.5">
          {busy === 'trigger' ? <Spinner size={13} className="text-navy-dark" /> : <Icon size={14} />}
          Trigger via {CHANNELS.find((c) => c.value === channel)?.label}
        </button>
      ) : (
        <div className={`rounded-lg border p-3 text-xs flex items-start gap-2 ${result.audit?.status === 'stored' ? 'bg-risk-low/[0.06] border-risk-low/20' : 'bg-white/[0.03] border-white/[0.06]'}`}>
          <ShieldCheck size={14} className={result.audit?.status === 'stored' ? 'text-risk-low mt-0.5' : 'text-gray-500 mt-0.5'} />
          <div className="min-w-0">
            <div className="text-gray-200 font-medium">Outreach #{result.action.id} triggered · audit {result.audit?.status}</div>
            {result.audit?.tx_hash && <div className="text-gray-500 font-mono truncate">tx {result.audit.tx_hash}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
