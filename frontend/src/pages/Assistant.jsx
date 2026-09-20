import React, { useState } from 'react';
import { client } from '../api/client';
import Card from '../components/Card';

export default function Assistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg = { role: 'user', content: input };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setBusy(true);
    try {
      const res = await client.post('/assistant/query', { query: userMsg.content, history: messages });
      setMessages([...history, { role: 'assistant', content: res.data.answer, meta: res.data }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">Bank Assistant</h1>
      <p className="text-xs text-gray-500">
        Merges RBI-policy RAG (grounded in the circulars in backend/data/docs) with churn/segment/forecast/complaint intent routing.
      </p>
      <Card className="h-[55vh] overflow-y-auto flex flex-col gap-3">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[80%] p-3 rounded text-sm ${m.role === 'user' ? 'bg-gold/20 self-end text-white' : 'bg-white/5 text-gray-200'}`}>
            {m.content}
            {m.meta && (
              <div className="text-xs text-gray-500 mt-1">
                intent: {m.meta.intent} · confidence: {m.meta.confidence} · source: {m.meta.source}
                {m.meta.sources?.length > 0 && <> · {m.meta.sources.join(', ')}</>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-gray-500 text-sm">Thinking...</div>}
      </Card>
      <form onSubmit={send} className="flex gap-2">
        <input
          className="flex-1 p-2 rounded bg-navy border border-gold/20 text-white text-sm"
          placeholder="Ask about RBI policy, churn risk, segments, forecasts, or complaints..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="bg-gold text-navy-dark px-4 rounded text-sm font-semibold" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
