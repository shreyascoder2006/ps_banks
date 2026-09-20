import { ArrowLeftRight, BookOpen, FileText, Languages, Mic, MicOff, Send, Volume2, VolumeX } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../api/client';
import { Spinner } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';
import { useToast } from '../components/Toast';

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

function SourcePill({ source }) {
  const live = ['groq', 'gemini'].includes(source) || source === 'authored' || source === 'same-language';
  return <span className={`badge ${live ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>{source}</span>;
}

function speak(text, lang, enabled) {
  if (!enabled || !('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang === lang) || voices.find((v) => v.lang.startsWith(lang.split('-')[0]));
  if (match) u.voice = match;
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

export default function FrontlineAssist() {
  const toast = useToast();
  const [languages, setLanguages] = useState([]);
  const [customerLang, setCustomerLang] = useState('hi-IN');
  const [staffLang, setStaffLang] = useState('en-IN');
  const [turns, setTurns] = useState([]);
  const [listening, setListening] = useState(null); // 'customer' | 'staff' | null
  const [interim, setInterim] = useState('');
  const [typed, setTyped] = useState('');
  const [typedAs, setTypedAs] = useState('customer');
  const [busy, setBusy] = useState(false);
  const [tts, setTts] = useState(true);
  const [guides, setGuides] = useState([]);
  const [guideId, setGuideId] = useState('');
  const [guideStaff, setGuideStaff] = useState(null);
  const [guideCust, setGuideCust] = useState(null);
  const [summary, setSummary] = useState(null);
  const recRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    client.get('/assistant/languages').then((res) => setLanguages(res.data.languages));
    client.get('/assistant/guides').then((res) => setGuides(res.data.guides));
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, interim]);

  useEffect(() => {
    if (!guideId) { setGuideStaff(null); setGuideCust(null); return; }
    setGuideStaff(null); setGuideCust(null);
    client.get(`/assistant/guides/${guideId}`, { params: { lang: staffLang } }).then((res) => setGuideStaff(res.data));
    client.get(`/assistant/guides/${guideId}`, { params: { lang: customerLang } }).then((res) => setGuideCust(res.data));
  }, [guideId, customerLang, staffLang]);

  const addTurn = async (speaker, text) => {
    const from = speaker === 'customer' ? customerLang : staffLang;
    const to = speaker === 'customer' ? staffLang : customerLang;
    setBusy(true);
    try {
      const res = await client.post('/assistant/translate', { text, source_lang: from, target_lang: to, speaker });
      const turn = { id: Date.now(), speaker, original: text, translated: res.data.translation, from, to, source: res.data.source, at: new Date() };
      setTurns((t) => [...t, turn]);
      speak(res.data.translation, to, tts);
      if (res.data.source.startsWith('fallback')) toast('Translation unavailable (no LLM key) - showing original text', 'info');
    } catch (err) {
      toast(err.response?.data?.detail || 'Translation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const startListening = (speaker) => {
    if (!Recognition) { toast('Speech recognition is not available in this browser - use the text box below.', 'info'); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Recognition();
    rec.lang = speaker === 'customer' ? customerLang : staffLang;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interimText += r[0].transcript;
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => { toast(`Mic error: ${e.error}`, 'error'); setListening(null); setInterim(''); };
    rec.onend = () => {
      setListening(null); setInterim('');
      if (finalText.trim()) addTurn(speaker, finalText.trim());
    };
    recRef.current = rec;
    setListening(speaker);
    rec.start();
  };

  const submitTyped = (e) => {
    e.preventDefault();
    if (!typed.trim()) return;
    addTurn(typedAs, typed.trim());
    setTyped('');
  };

  const makeSummary = async () => {
    setBusy(true);
    try {
      const res = await client.post('/assistant/summary', {
        turns: turns.map((t) => ({ speaker: t.speaker, original: t.original, translated: t.translated, lang: t.from })),
        customer_lang: customerLang, staff_lang: staffLang,
      });
      setSummary(res.data);
    } finally {
      setBusy(false);
    }
  };

  const langLabel = (code) => languages.find((l) => l.code === code)?.label || code;
  const swap = () => { setCustomerLang(staffLang); setStaffLang(customerLang); };

  return (
    <div>
      <PageHeader
        icon={Languages}
        title="Frontline Desk Assist"
        subtitle="Customer speaks their language, staff hears theirs. Browser speech in/out, banking-glossary translation, process guides, bilingual record."
        action={
          <button onClick={() => setTts((v) => !v)} className={`btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5 ${tts ? 'text-gold' : 'text-gray-500'}`}>
            {tts ? <Volume2 size={13} /> : <VolumeX size={13} />} Voice reply {tts ? 'on' : 'off'}
          </button>
        }
      />

      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Customer speaks</div>
          <select className="input-field py-2" value={customerLang} onChange={(e) => setCustomerLang(e.target.value)}>
            {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <button onClick={swap} className="btn-ghost p-2.5 mb-0.5" title="Swap languages"><ArrowLeftRight size={15} /></button>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Staff speaks</div>
          <select className="input-field py-2" value={staffLang} onChange={(e) => setStaffLang(e.target.value)}>
            {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Conversation" className="col-span-2" noPad>
          <div ref={logRef} className="h-[46vh] overflow-y-auto px-5 py-4 space-y-3">
            {turns.length === 0 && !interim && (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-500">
                <Mic size={26} className="mb-2 opacity-40" />
                <p className="text-sm">Tap a mic below, or type. Each turn is translated and spoken in the other person's language.</p>
                {!Recognition && <p className="text-xs text-gray-600 mt-2">Speech recognition isn't available in this browser; typed input still works end-to-end.</p>}
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className={`flex ${t.speaker === 'customer' ? '' : 'flex-row-reverse'} gap-2.5 fade-in`}>
                <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${t.speaker === 'customer' ? 'bg-white/[0.04] border border-white/[0.06] rounded-tl-sm' : 'bg-gold/[0.12] rounded-tr-sm'}`}>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 flex items-center gap-2">
                    {t.speaker} · {langLabel(t.from)} → {langLabel(t.to)} <SourcePill source={t.source} />
                  </div>
                  <div className="text-sm text-gray-300">{t.original}</div>
                  <div className="text-sm text-white font-medium mt-1 flex items-start gap-2">
                    <span className="flex-1">{t.translated}</span>
                    <button onClick={() => speak(t.translated, t.to, true)} className="text-gray-500 hover:text-gold shrink-0" title="Play"><Volume2 size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
            {interim && <div className="text-sm text-gray-500 italic">{interim}…</div>}
          </div>

          <div className="border-t border-white/[0.06] p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => startListening('customer')} disabled={busy || (listening && listening !== 'customer')} className={`py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border transition-all ${listening === 'customer' ? 'bg-risk-critical/15 border-risk-critical/40 text-risk-critical animate-pulse' : 'bg-white/[0.04] border-white/10 text-gray-200 hover:border-gold/40'}`}>
                {listening === 'customer' ? <MicOff size={16} /> : <Mic size={16} />} {listening === 'customer' ? 'Listening… tap to stop' : `Customer speaks (${langLabel(customerLang)})`}
              </button>
              <button onClick={() => startListening('staff')} disabled={busy || (listening && listening !== 'staff')} className={`py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border transition-all ${listening === 'staff' ? 'bg-risk-critical/15 border-risk-critical/40 text-risk-critical animate-pulse' : 'bg-gold/[0.10] border-gold/30 text-gold hover:border-gold/60'}`}>
                {listening === 'staff' ? <MicOff size={16} /> : <Mic size={16} />} {listening === 'staff' ? 'Listening… tap to stop' : `Staff replies (${langLabel(staffLang)})`}
              </button>
            </div>
            <form onSubmit={submitTyped} className="flex gap-2">
              <select className="input-field py-2 w-32 text-xs" value={typedAs} onChange={(e) => setTypedAs(e.target.value)}>
                <option value="customer">as customer</option>
                <option value="staff">as staff</option>
              </select>
              <input className="input-field py-2" placeholder="Or type what was said…" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button type="submit" disabled={busy || !typed.trim()} className="btn-primary px-4 flex items-center gap-1.5 text-sm">{busy ? <Spinner size={13} className="text-navy-dark" /> : <Send size={14} />}</button>
            </form>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Process guide" action={<BookOpen size={14} className="text-gold" />}>
            <select className="input-field py-2 text-sm mb-3" value={guideId} onChange={(e) => setGuideId(e.target.value)}>
              <option value="">Choose a process…</option>
              {guides.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
            {guideId && (
              <div className="space-y-3">
                {[['Staff', guideStaff, staffLang], ['Customer', guideCust, customerLang]].map(([who, g, lang]) => (
                  <div key={who}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">{who} · {langLabel(lang)}</span>
                      {g && <SourcePill source={g.source} />}
                      {g && <button onClick={() => speak(g.steps.join('. '), lang, true)} className="ml-auto text-gray-500 hover:text-gold" title="Read aloud"><Volume2 size={12} /></button>}
                    </div>
                    {!g ? <div className="skeleton h-16" /> : (
                      <ol className="text-xs text-gray-300 space-y-1 list-decimal list-inside leading-relaxed">
                        {g.steps.map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Interaction record" action={<FileText size={14} className="text-gold" />}>
            <button onClick={makeSummary} disabled={busy || turns.length === 0} className="btn-primary w-full py-2 text-sm mb-3">Generate bilingual summary</button>
            {summary && (
              <div className="space-y-3 fade-in text-xs">
                <SourcePill source={summary.source} />
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{langLabel(staffLang)}</div>
                  <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">{summary.staffSummary}</p>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{langLabel(customerLang)}</div>
                  <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">{summary.customerSummary}</p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
