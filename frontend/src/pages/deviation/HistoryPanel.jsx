import { ArrowUpRight, CheckCircle2, Circle, Clock, MessageSquareText, Undo2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useGetImirChangesQuery } from '../../api/imirApi.js';
import { formatDate, formatDateTime, formatRelative } from '../../utils/format.js';
import { fieldLabel, HISTORY_LABELS, stepDetail } from './historyFormat.js';
import { roundBadges } from './rounds.js';

const BADGE_LOOP = { inspection: 'Inspection', form: 'Form', qty: 'Quantity', capa: 'CAPA', escalation: 'Escalation' };

// What kind of step it is, for the colour and the filter.
const ESCALATION = new Set(['ESCALATE', 'HOLD', 'SENIOR_DECISION', 'SENIOR_RESULT', 'OVERRIDE', 'OPS_TIMEOUT']);
const SEND_BACK = new Set(['REVERT', 'SEND_BACK', 'RETURN_QTY', 'DN_RESUBMIT']);
function kindOf(action) {
  if (ESCALATION.has(action)) return 'escalation';
  if (SEND_BACK.has(action)) return 'sendback';
  if (/REJECT|AUTO_CLOSE|TIMEOUT|REMINDER/.test(action)) return 'bad';
  if (/APPROVE|VERIFY|CLOSE$/.test(action)) return 'good';
  return 'neutral';
}
const LOOK = {
  escalation: { icon: ArrowUpRight, dot: 'bg-orange-500 text-white', box: 'border-l-orange-400 bg-orange-50/60', tag: 'bg-orange-100 text-orange-800', name: 'Escalation' },
  sendback: { icon: Undo2, dot: 'bg-amber-500 text-white', box: 'border-l-amber-400 bg-amber-50/60', tag: 'bg-amber-100 text-amber-900', name: 'Sent back' },
  bad: { icon: XCircle, dot: 'bg-white text-rose-600', box: 'border-l-rose-400 bg-rose-50/50', tag: 'bg-rose-100 text-rose-800', name: null },
  good: { icon: CheckCircle2, dot: 'bg-white text-emerald-600', box: 'border-l-transparent', tag: null, name: null },
  neutral: { icon: Circle, dot: 'bg-white text-blue-600', box: 'border-l-transparent', tag: null, name: null },
  remark: { icon: MessageSquareText, dot: 'bg-white text-slate-500', box: 'border-l-transparent', tag: null, name: null },
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
  return <blockquote className="mt-1.5 border-l-2 border-blue-300 bg-white/80 px-3 py-1.5 text-sm text-slate-800 whitespace-pre-line rounded-r-md">{children}</blockquote>;
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
export default function HistoryPanel({ imirId, history = [], owner, current }) {
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
        <h2 className="section-title">History</h2>
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
          <div key={d.key} className="mb-3 last:mb-0">
            <div className="sticky top-0 z-[1] bg-white/95 py-1 text-xs font-semibold text-slate-500">{dayTitle(d.key)}</div>
            <ol className="relative ml-2 border-l-2 border-slate-100 space-y-2.5 pt-1">
              {d.items.map((i) => {
                const look = LOOK[i.kind];
                const Icon = i.type === 'step' && i.kind === 'neutral' && !i.step.actorId ? Clock : look.icon;
                const dot = <Icon className={`absolute -left-[10px] mt-2 w-[18px] h-[18px] p-0.5 rounded-full ring-2 ring-white ${look.dot}`} />;
                if (i.type === 'remark') {
                  return (
                    <li key={i.key} className="ml-4">
                      {dot}
                      <div className="px-2 py-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-medium text-slate-800">{i.title}{i.edited ? ' (edited)' : ''}</span>
                          <span className="text-xs text-slate-500">{i.actorName ?? 'System'}, {timeOf(i.at)}</span>
                        </div>
                        <Remark>{i.text}</Remark>
                      </div>
                    </li>
                  );
                }
                const h = i.step;
                const detail = stepDetail(h);
                const badge = badges.get(h.id);
                return (
                  <li key={i.key} className="ml-4">
                    {dot}
                    <div className={`rounded-r-lg border-l-4 px-2 py-1.5 ${look.box}`}>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-slate-900">{HISTORY_LABELS[h.action] ?? h.action}</span>
                        {look.name && <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${look.tag}`}>{look.name}</span>}
                        {badge && (
                          <span className="rounded-full px-2 py-px text-[11px] font-semibold bg-white text-slate-700 ring-1 ring-slate-200">
                            {BADGE_LOOP[badge.loop]} round {badge.no}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500" title={formatDateTime(h.at)}>
                        {h.actorName ? `${h.actorName}${h.actingRoleName ? `, ${h.actingRoleName}` : ''}` : 'System'}, {timeOf(h.at)}
                      </div>
                      {detail && <div className="text-xs text-slate-700 mt-0.5">{detail}</div>}
                      {h.remark && <Remark>{h.remark}</Remark>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

