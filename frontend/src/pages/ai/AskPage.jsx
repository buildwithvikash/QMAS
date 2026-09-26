import { ArrowUp, Bot, Eraser, Loader2, Sparkles, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAiChatMutation, useGetAiStatusQuery } from '../../api/aiApi.js';
import Markdown from '../../components/ui/Markdown.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';

const SUGGESTIONS = [
  'Which vendors had the highest Not-OK rate in the last 3 months?',
  'Show failed lots received this month',
  'Which checkpoints fail most often, and for which items?',
  'Compare this month with last month: lots, Not OK, rejections',
  'Which open lots are most likely to fail?',
  'Are any measurements drifting toward their limits?',
];
const TOOL_WORDS = { find_records: 'searched records', quality_stats: 'counted lots', supplier_risk: 'checked supplier risk', lot_detail: 'read a lot' };
const STORE = 'qmas.ask.history';

/**
 * Ask QMAS: questions about inspection, deviation and DN data in plain words. Claude looks the data
 * up through QMAS (only what this user may see) and answers with figures and document numbers.
 * The conversation stays in this browser tab.
 */
export default function AskPage() {
  const { data: status } = useGetAiStatusQuery();
  const [ask, { isLoading }] = useAiChatMutation();
  const [messages, setMessages] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORE) ?? '[]');
    } catch {
      return [];
    }
  });
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const end = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-20)));
    } catch { /* storage unavailable: keep in memory only */ }
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isLoading]);

  const send = async (q) => {
    const question = (q ?? text).trim();
    if (!question || isLoading) return;
    setError('');
    setText('');
    const next = [...messages, { role: 'user', content: question }];
    setMessages(next);
    try {
      // Only the last few turns go back, so long chats stay quick and cheap.
      let recent = next.slice(-10);
      while (recent[0]?.role !== 'user') recent = recent.slice(1); // the conversation must start with a question
      const r = await ask(recent.map(({ role, content }) => ({ role, content }))).unwrap();
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, tools: r.toolCalls }]);
    } catch (err) {
      setError(apiError(err).message);
      setMessages(messages);
      setText(question);
    }
    input.current?.focus();
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)]">
      <PageHeader icon={Sparkles} title="Ask QMAS" subtitle="Questions about lots, vendors, deviations and DNs, answered from QMAS data">
        {status?.provider === 'puter' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900" title="Claude through Puter, for trying the AI on demo data. Switch to a company Anthropic key before real data.">Trial AI · demo data only</span>
        )}
        {messages.length > 0 && (
          <button type="button" onClick={() => setMessages([])} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"><Eraser className="w-3.5 h-3.5" />New chat</button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
          {status && !status.configured && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">AI is not set up on this server yet. The administrator adds the Claude settings (ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL).</p>
          )}
          {messages.length === 0 && (
            <div className="pt-6 text-center">
              <span className="inline-flex w-12 h-12 rounded-2xl bg-violet-100 items-center justify-center"><Sparkles className="w-6 h-6 text-violet-600" /></span>
              <h2 className="mt-3 text-lg font-semibold text-slate-900">What would you like to know?</h2>
              <p className="text-sm text-slate-500">Answers use only the data you can see in QMAS, with the document numbers behind them.</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2 text-left">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} disabled={!status?.configured}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 hover:border-violet-300 hover:bg-violet-50/40 cursor-pointer disabled:opacity-50 disabled:cursor-default">{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role === 'assistant' && <span className="w-8 h-8 shrink-0 rounded-lg bg-violet-100 flex items-center justify-center"><Bot className="w-4 h-4 text-violet-700" /></span>}
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200'}`}>
                {m.role === 'user' ? <p className="text-sm whitespace-pre-line">{m.content}</p> : <Markdown text={m.content} />}
                {m.tools?.length > 0 && <p className="mt-1.5 text-[11px] text-slate-400">Looked up: {[...new Set(m.tools.map((t) => TOOL_WORDS[t] ?? t))].join(', ')}</p>}
              </div>
              {m.role === 'user' && <span className="w-8 h-8 shrink-0 rounded-lg bg-slate-100 flex items-center justify-center"><User className="w-4 h-4 text-slate-600" /></span>}
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <span className="w-8 h-8 shrink-0 rounded-lg bg-violet-100 flex items-center justify-center"><Loader2 className="w-4 h-4 text-violet-700 animate-spin" /></span>
              <p className="text-sm text-slate-500 py-2">Looking at the data…</p>
            </div>
          )}
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div ref={end} />
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <form className="max-w-3xl mx-auto flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={1500} disabled={!status?.configured}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask about lots, vendors, failures, trends…"
            className="flex-1 resize-none max-h-40 px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-500 disabled:bg-slate-50" />
          <button type="submit" disabled={!text.trim() || isLoading || !status?.configured} aria-label="Ask"
            className="h-10 w-10 shrink-0 rounded-xl bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 cursor-pointer">
            <ArrowUp className="w-5 h-5" />
          </button>
        </form>
        <p className="max-w-3xl mx-auto mt-1 text-[11px] text-slate-400">AI answers can be wrong; open the records to check before acting.</p>
      </div>
    </div>
  );
}
