import { Bot, Database, FileText, Send, Sparkles, Trash2, User, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { client } from '../api/client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const SUGGESTIONS = [
  'Give me a summary of the whole book',
  'Which 5 critical-risk customers have the highest balance?',
  'How is the outreach channel chosen?',
  'Compare average churn risk across branches',
  'What are the SLA hours for each complaint severity?',
  'Explain how the churn model works',
];

// Minimal markdown: **bold**, `code`, "- " bullets, blank-line paragraphs.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="px-1 rounded bg-white/10 text-gold-light text-[12px]">{part.slice(1, -1)}</code>;
    return part;
  });
}

function Markdown({ text }) {
  const blocks = [];
  let list = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length} className="list-disc pl-5 space-y-0.5">{list}</ul>); list = []; } };
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (m) list.push(<li key={i}>{inline(m[1])}</li>);
    else { flush(); if (line.trim()) blocks.push(<p key={`p${i}`}>{inline(line.replace(/^#+\s*/, ''))}</p>); }
  });
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [health, setHealth] = useState(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!open || health) return;
    client.get('/chat/status').then((r) => setHealth(r.data)).catch(() => setHealth({ ollama: false }));
    client.post('/chat/warmup').catch(() => {});
  }, [open, health]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, statusText, open]);

  const patchLast = (fn) => setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    setMessages([...messages, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    setStatusText('Thinking...');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('bank_pulse_token')}` },
        body: JSON.stringify({ message: q, history }),
      });
      if (res.status === 401) { localStorage.removeItem('bank_pulse_token'); window.location.href = '/login'; return; }
      if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop();
        for (const frame of frames) {
          if (!frame.startsWith('data: ')) continue;
          const ev = JSON.parse(frame.slice(6));
          if (ev.type === 'token') { setStatusText(''); patchLast((m) => ({ ...m, content: m.content + ev.text })); }
          else if (ev.type === 'status') setStatusText(ev.text);
          else if (ev.type === 'error') patchLast((m) => ({ ...m, content: ev.text, error: true }));
          else if (ev.type === 'done') patchLast((m) => ({ ...m, meta: ev }));
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') patchLast((m) => ({ ...m, content: m.content || `Could not reach the chatbot: ${err.message}`, error: true }));
    } finally {
      setBusy(false);
      setStatusText('');
      abortRef.current = null;
    }
  };

  const clear = () => { abortRef.current?.abort(); setMessages([]); setBusy(false); setStatusText(''); };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open Bank Pulse assistant"
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-gradient-to-br from-gold-light to-gold text-navy-dark font-semibold text-[13px] shadow-glow hover:brightness-110 transition"
      >
        <Sparkles size={15} aria-hidden="true" /> <span className="hidden sm:inline">Ask Bank Pulse</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 w-[430px] max-w-[calc(100vw-2rem)] h-[620px] max-h-[calc(100vh-3rem)] flex flex-col rounded-2xl bg-navy border border-white/10 shadow-card overflow-hidden fade-in">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.08] bg-navy-dark/70">
        <div className="w-8 h-8 rounded-lg bg-gold/15 flex items-center justify-center"><Bot size={16} className="text-gold" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white leading-tight">Bank Pulse Assistant</div>
          <div className="text-[10px] text-gray-500 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${health?.ollama && health?.modelInstalled ? 'bg-risk-low' : health ? 'bg-risk-critical' : 'bg-gray-500'}`} />
            {health ? (health.ollama ? `${health.model} · runs locally via Ollama` : 'Ollama offline') : 'connecting...'}
          </div>
        </div>
        <button onClick={clear} title="Clear chat" className="p-1.5 text-gray-500 hover:text-gold rounded-md hover:bg-white/5"><Trash2 size={14} /></button>
        <button onClick={() => setOpen(false)} title="Close" className="p-1.5 text-gray-500 hover:text-gold rounded-md hover:bg-white/5"><X size={15} /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center pt-4">
            <p className="text-gray-400 text-sm mb-1">Ask me anything about Bank Pulse.</p>
            <p className="text-gray-600 text-xs mb-4">Live customer data, churn model, segments, outreach, complaints, RBI policy, code and more.</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="btn-ghost text-left px-3 py-2 text-xs text-gray-300">{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${m.role === 'user' ? 'bg-white/10' : 'bg-gold/15'}`}>
              {m.role === 'user' ? <User size={12} className="text-gray-300" /> : <Sparkles size={12} className="text-gold" />}
            </div>
            <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
              m.role === 'user' ? 'bg-gold/[0.12] text-white rounded-tr-sm'
                : m.error ? 'bg-risk-critical/10 text-risk-critical border border-risk-critical/20 rounded-tl-sm'
                : 'bg-white/[0.04] text-gray-200 border border-white/[0.05] rounded-tl-sm'}`}>
              {m.role === 'assistant' && !m.content && busy && i === messages.length - 1
                ? <span className="text-gray-500 text-xs">{statusText || 'Thinking...'}</span>
                : m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
              {m.role === 'assistant' && busy && i === messages.length - 1 && m.content && statusText && (
                <div className="text-[11px] text-gray-500 mt-1.5">{statusText}</div>
              )}
              {m.meta && (m.meta.tools?.length > 0 || m.meta.sources?.length > 0) && (
                <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-1">
                  {m.meta.tools?.length > 0 && (
                    <div className="flex items-start gap-1.5 text-[10px] text-risk-low"><Database size={10} className="mt-0.5 shrink-0" />Live data: {m.meta.tools.map((t) => t.replace(/_/g, ' ')).join(', ')}</div>
                  )}
                  {m.meta.sources?.length > 0 && (
                    <div className="flex items-start gap-1.5 text-[10px] text-gray-500"><FileText size={10} className="mt-0.5 shrink-0" />{m.meta.sources.slice(0, 3).join(' · ')}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 p-3 border-t border-white/[0.08] bg-navy-dark/50">
        <input
          className="input-field py-2 text-sm"
          placeholder="Ask about customers, churn, complaints, policy..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={busy || !input.trim()} className="btn-primary px-3 flex items-center text-sm" title="Send"><Send size={14} /></button>
      </form>
    </div>
  );
}
