import { ArrowUpRight, Check, CheckCircle2, Clock, Copy, History, MessageSquareText, MoreHorizontal, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useGetImirChangesQuery } from '../../api/imirApi.js';
import { formatDate, formatDateTime, formatRelative } from '../../utils/format.js';
import { fieldLabel, HISTORY_LABELS, stepDetail } from './historyFormat.js';
import { roundBadges } from './rounds.js';

const BADGE_LOOP = { inspection: 'Inspection', form: 'Form', qty: 'Quantity', capa: 'CAPA', escalation: 'Escalation' };

// What kind of step it is, for the colour and the filter.
const ESCALATION = new Set(['ESCALATE', 'HOLD', 'SENIOR_DECISION', 'SENIOR_RESULT', 'OVERRIDE', 'OPS_TIMEOUT']);
const SEND_BACK = new Set(['REVERT', 'SEND_BACK', 'RETURN_QTY', 'DN_RESUBMIT']);
function kindOf(action) {
  if (action.startsWith('REVERS')) return 'reversal';
  if (ESCALATION.has(action)) return 'escalation';
  if (SEND_BACK.has(action)) return 'sendback';
  if (/REJECT|AUTO_CLOSE|TIMEOUT|REMINDER/.test(action)) return 'bad';
  if (/APPROVE|VERIFY|CLOSE$/.test(action)) return 'good';
  return 'neutral';
}
// Timeline look per kind: the rail icon, the card (left edge and tint) and the kind's tag.
const LOOK = {
  escalation: { icon: ArrowUpRight, dot: 'bg-orange-500 text-white', card: 'border-orange-200 border-l-orange-400 bg-orange-50/70', tag: 'bg-orange-100 text-orange-800', name: 'Escalation' },
  sendback: { icon: Undo2, dot: 'bg-amber-400 text-white', card: 'border-amber-200 border-l-amber-400 bg-amber-50/70', tag: 'bg-amber-100 text-amber-900', name: 'Send back' },
  bad: { icon: X, dot: 'bg-rose-600 text-white', card: 'border-rose-300 border-l-rose-500 bg-rose-50/80', tag: 'bg-rose-100 text-rose-700', name: 'Rejection' },
  good: { icon: Check, dot: 'bg-emerald-600 text-white', card: 'border-emerald-200 border-l-emerald-500 bg-emerald-50/50', tag: 'bg-emerald-100 text-emerald-800', name: null },
  reversal: { icon: History, dot: 'bg-violet-600 text-white', card: 'border-violet-200 border-l-violet-500 bg-violet-50/60', tag: 'bg-violet-100 text-violet-800', name: 'Reversal' },
  neutral: { icon: null, dot: 'bg-white border-[5px] border-blue-600', card: 'border-slate-200 border-l-blue-400 bg-white', tag: null, name: null },
  remark: { icon: MessageSquareText, dot: 'bg-slate-500 text-white', card: 'border-slate-200 border-l-slate-400 bg-slate-50/70', tag: 'bg-slate-100 text-slate-700', name: 'Remark' },
};
// A more precise tag than the kind's for some steps.
const TAG = {
  RECOMMEND_REJECT: 'Recommendation', OPS_TIMEOUT: 'Timed out', CAPA_REMINDER: 'Reminder', AUTO_CLOSE: 'Auto-closed', OVERRIDE: 'Override',
  REVERSAL_REQUEST: 'Reversal', REVERSED: 'Reversal', REVERSAL_REJECTED: 'Reversal',
};

const FILTERS = [['all', 'All'], ['escalation', 'Escalations'], ['sendback', 'Send-backs'], ['remark', 'Remarks']];
const REMARK_FIELD = /(^|_)remark$/;

const dayKey = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(at));
function dayTitle(key) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  return key === today ? 'Today' : key === yesterday ? 'Yesterday' : formatDate(`${key}T00:00:00+05:30`);
}
const timeOf = (at) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));

function Remark({ children }) {
  return <blockquote className="mt-2 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-800 whitespace-pre-line">{children}</blockquote>;
}

/** The ··· menu of a timeline card: copy the entry or its remark. */
function CardMenu({ text, remark }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const copy = async (value, what) => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Could not copy');
    }
  };
  return (
    <div ref={ref} className="relative -mr-1 -mt-0.5 shrink-0">
      <button type="button" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-black/5 hover:text-slate-800 cursor-pointer">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="animate-fadeIn absolute right-0 top-8 z-10 w-40 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lift">
          <button type="button" role="menuitem" onClick={() => copy(text, 'Entry')} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"><Copy className="h-3.5 w-3.5" />Copy entry</button>
          {remark && <button type="button" role="menuitem" onClick={() => copy(remark, 'Remark')} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"><MessageSquareText className="h-3.5 w-3.5" />Copy remark</button>}
        </div>
      )}
    </div>
  );
}

/** One timeline row: time, the rail with the step's icon, and its card. */
function Row({ at, look, icon: Icon, last, children }) {
  return (
    <li className="grid grid-cols-[3rem_2.25rem_minmax(0,1fr)] gap-x-1">
      <time dateTime={at} title={formatDateTime(at)} className="pt-2.5 text-right text-xs font-medium tabular text-slate-500">{timeOf(at)}</time>
      <div className="relative flex justify-center">
        <span className={`absolute left-1/2 top-0 w-0.5 -translate-x-1/2 bg-slate-200 ${last ? 'h-3' : 'bottom-0'}`} aria-hidden="true" />
        <span className={`relative z-[1] mt-1.5 grid h-7 w-7 place-items-center rounded-full ring-4 ring-white ${look.dot}`} aria-hidden="true">
          {Icon && <Icon className="h-4 w-4" strokeWidth={2.5} />}
        </span>
      </div>
      <div className="pb-3">{children}</div>
    </li>
  );
}

/** Where the record stands now, pinned above the timeline. */
function NowCard({ current, since }) {
  if (!current) return null;
  if (current.closed) {
    return (
      <div className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${current.tone === 'bad' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
        <CheckCircle2 className="w-4 h-4" /><span>Closed: <span className="font-semibold">{current.label}</span></span>
      </div>
    );
  }
  return (
    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60 animate-ping" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-600" /></span>
        <span className="text-slate-600">Current stage</span>
        <span className="font-semibold text-blue-900">{current.label}</span>
      </div>
      {current.holder && (
        <p className="mt-0.5 ml-[18px] text-xs text-slate-600">
          With <span className="font-medium text-slate-800">{current.holder}</span>
          {since && <> for <span title={formatDateTime(since)}>{formatRelative(since).replace(' ago', '')}</span></>}
        </p>
      )}
    </div>
  );
}

/**
 * History of a record as its workflow: current stage on top, then, newest first and grouped by
 * day, every step (who, in which role, remark) with escalations and send-backs highlighted, and
 * remarks written on the record itself (checkpoint and review remarks). Data entry is left out.
 * `owner` limits remarks to one document (the DN page shows only DN and CAPA remarks).
 */
export default function HistoryPanel({ imirId, history = [], owner, current, title = 'History' }) {
  const [filter, setFilter] = useState('all');
  const { data: changes = [] } = useGetImirChangesQuery(imirId, { skip: !imirId });

  const items = useMemo(() => {
    const stepRemark = new Map(history.filter((h) => h.requestId && h.remark).map((h) => [h.requestId, h.remark.trim()]));
    const remarks = (owner ? changes.filter((c) => c.owner === owner) : changes).flatMap((c) => c.fields
      .filter((f) => REMARK_FIELD.test(f.key) && typeof f.new === 'string' && f.new.trim() && f.new !== f.old)
      // The same text as the step's own remark is already shown on that step.
      .filter((f) => stepRemark.get(c.requestId) !== f.new.trim())
      .map((f) => ({
        type: 'remark', key: `r${c.id}${f.key}`, at: c.at, kind: 'remark', actorName: c.actorName,
        title: `${fieldLabel(f.key)}${c.entity === 'CHECKPOINT' || c.entity === 'READING' ? ` on ${c.label}` : ''}`, text: f.new, edited: !!f.old,
      })));
    const steps = history.map((h) => ({ type: 'step', key: `s${h.id}`, at: h.at, kind: kindOf(h.action), step: h }));
    return [...steps, ...remarks].sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [changes, history, owner]);

  const badges = useMemo(() => roundBadges(history), [history]);
  const count = (k) => items.filter((i) => (k === 'remark' ? i.kind === 'remark' || i.step?.remark : i.kind === k)).length;
  const visible = items.filter((i) => filter === 'all' || (filter === 'remark' ? i.kind === 'remark' || i.step?.remark : i.kind === filter));
  const days = [];
  for (const i of visible) {
    const k = dayKey(i.at);
    if (days.at(-1)?.key !== k) days.push({ key: k, items: [] });
    days.at(-1).items.push(i);
  }
  const since = history.at(-1)?.at;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-3 border-b border-slate-100">
        <h2 className="section-title">{title}</h2>
        <div role="tablist" className="ml-auto flex flex-wrap gap-1 text-xs">
          {FILTERS.map(([k, l]) => {
            const n = k === 'all' ? null : count(k);
            if (n === 0 && filter !== k) return null;
            return (
              <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={`px-2.5 py-1 rounded-full cursor-pointer ring-1 ${filter === k ? 'bg-blue-600 text-white ring-blue-600 font-medium' : 'bg-white text-slate-600 ring-slate-200 hover:text-slate-900'}`}>
                {l}{n ? ` ${n}` : ''}
              </button>
            );
          })}
        </div>
      </div>
      <div className="px-4 py-3">
        <NowCard current={current} since={since} />
        {!visible.length && <p className="text-sm text-slate-500 py-2">{filter === 'all' ? 'No workflow steps yet.' : 'Nothing of this kind yet.'}</p>}
        {days.map((d) => (
          <div key={d.key} className="mb-1 last:mb-0">
            <div className="sticky top-0 z-[2] grid grid-cols-[3rem_2.25rem_minmax(0,1fr)] gap-x-1 bg-white/95 py-1">
              <span className="col-span-2 justify-self-center rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white whitespace-nowrap shadow-sm">{dayTitle(d.key)}</span>
            </div>
            <ol>
              {d.items.map((i, n) => {
                const look = LOOK[i.kind];
                const last = n === d.items.length - 1;
                if (i.type === 'remark') {
                  return (
                    <Row key={i.key} at={i.at} look={look} icon={look.icon} last={last}>
                      <div className={`rounded-lg border border-l-4 px-3 py-2 ${look.card}`}>
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-sm font-semibold text-slate-900">{i.title}{i.edited ? ' (edited)' : ''}</span>
                              <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${look.tag}`}>{look.name}</span>
                            </div>
                            <div className="text-xs text-slate-500">By {i.actorName ?? 'System'}</div>
                          </div>
                          <CardMenu text={`${i.title} — ${i.actorName ?? 'System'}, ${formatDateTime(i.at)}\n${i.text}`} remark={i.text} />
                        </div>
                        <Remark>{i.text}</Remark>
                      </div>
                    </Row>
                  );
                }
                const h = i.step;
                const detail = stepDetail(h);
                const badge = badges.get(h.id);
                const label = HISTORY_LABELS[h.action] ?? h.action;
                const tag = TAG[h.action] ?? look.name;
                const by = h.actorName ? `${h.actorName}${h.actingRoleName ? ` (${h.actingRoleName})` : ''}` : 'System';
                const icon = i.kind === 'neutral' && !h.actorId ? Clock : look.icon;
                return (
                  <Row key={i.key} at={h.at} look={!look.icon && icon ? { ...look, dot: 'bg-slate-500 text-white' } : look} icon={icon} last={last}>
                    <div className={`rounded-lg border border-l-4 px-3 py-2 ${look.card}`}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold text-slate-900">{label}</span>
                            {tag && <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${look.tag}`}>{tag}</span>}
                            {badge && <span className="rounded-full bg-blue-100 px-2 py-px text-[11px] font-semibold text-blue-700">{BADGE_LOOP[badge.loop]} round {badge.no}</span>}
                          </div>
                          <div className="text-xs text-slate-500">By {by}</div>
                          {detail && <div className="mt-0.5 text-xs text-slate-700">{detail}</div>}
                        </div>
                        <CardMenu text={[`${label} — ${by}, ${formatDateTime(h.at)}`, detail, h.remark].filter(Boolean).join('\n')} remark={h.remark} />
                      </div>
                      {h.remark && <Remark>{h.remark}</Remark>}
                    </div>
                  </Row>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

