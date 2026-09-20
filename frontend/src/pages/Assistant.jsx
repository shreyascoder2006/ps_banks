import { Landmark, Send, Sparkles, User } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { client } from '../api/client';
import { Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';

const SUGGESTIONS = [
  'What is the RBI zero-liability rule?',
  'Which customers are at critical churn risk?',
  'How does RFM segmentation work here?',
];

export default function Assistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q) return;
    const userMsg = { role: 'user', content: q };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setBusy(true);
    try {
      const res = await client.post('/assistant/query', { query: q, history: messages });
      setMessages([...history, { role: 'assistant', content: res.data.answer, meta: res.data }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon={Sparkles}
        title="Bank Assistant"
        subtitle="Merges RBI-policy RAG (grounded in backend/data/docs) with churn/segment/forecast/complaint intent routing."
      />

      <Card noPad className="flex flex-col h-[62vh]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center py-10">
              <div className="w-12 h-12 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center mb-3">
                <Landmark size={20} className="text-gold" />
              </div>
              <p className="text-gray-400 text-sm mb-4">Ask about RBI policy, churn risk, segments, forecasts, or complaints.</p>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="btn-ghost text-left px-3 py-2 text-xs text-gray-300">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2.5 fade-in ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-white/10' : 'bg-gold/15'}`}>
                {m.role === 'user' ? <User size={13} className="text-gray-300" /> : <Sparkles size={13} className="text-gold" />}
              </div>
              <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-gold/[0.12] text-white rounded-tr-sm'
                  : 'bg-white/[0.04] text-gray-200 rounded-tl-sm border border-white/[0.05]'
              }`}>
                {m.content}
                {m.meta && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/[0.06]">
                    <span className="badge bg-white/[0.06] text-gray-400">{m.meta.intent}</span>
                    <span className="badge bg-white/[0.06] text-gray-400">{Math.round(m.meta.confidence * 100)}% confidence</span>
                    <span className={`badge ${m.meta.source === 'groq' ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>{m.meta.source}</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gold/15 flex items-center justify-center shrink-0">
                <Sparkles size={13} className="text-gold" />
              </div>
              <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white/[0.04] border border-white/[0.05] flex items-center gap-2">
                <Spinner size={13} />
                <span className="text-gray-500 text-xs">Thinking...</span>
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex gap-2 p-4 border-t border-white/[0.06]"
        >
          <input
            className="input-field py-2.5"
            placeholder="Ask about RBI policy, churn risk, segments, forecasts, or complaints..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn-primary px-4 flex items-center gap-1.5 text-sm">
            <Send size={14} /> Send
          </button>
        </form>
      </Card>
    </div>
  );
}
