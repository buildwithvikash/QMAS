import { ArrowRight, CheckCircle2, CornerUpLeft, FileText, History, Inbox, ListTodo, MoreHorizontal, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetMyRecentQuery } from '../../api/workflowApi.js';
import { formatDate, formatRelative } from '../../utils/format.js';
import { HISTORY_LABELS } from '../deviation/historyFormat.js';
import { HomeCard, ViewAll } from './homeUi.jsx';
import { byUrgency, KIND, KINDS, urgencyOf } from './taskUi.js';

const PRIORITY = {
  overdue: ['High', 'bg-rose-50 text-rose-700 ring-rose-200', 'bg-rose-500'],
  due: ['High', 'bg-rose-50 text-rose-700 ring-rose-200', 'bg-rose-500'],
  stale: ['Medium', 'bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-500'],
  waiting: ['Medium', 'bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-500'],
  fresh: ['Low', 'bg-emerald-50 text-emerald-700 ring-emerald-200', 'bg-emerald-500'],
};
const SHOW = 5;

const Pill = ({ className, dot, children }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${className}`}>
    {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}{children}
  </span>
);

/**
 * The user's work as a table, most urgent first: priority (from the deadline or how long it has
 * waited), task, reference, item / vendor, due date, where it stands, and a button to open it.
 * Kind chips narrow it; "View all" shows every task.
 */
export function ActiveTasks({ tasks, isLoading, error }) {
  const [kind, setKind] = useState(null);
  const [all, setAll] = useState(false);
  const list = tasks.filter((t) => !kind || t.kind === kind).sort(byUrgency);
  const shown = all ? list : list.slice(0, SHOW);
  const kinds = KINDS.filter((k) => tasks.some((t) => t.kind === k.key));
  return (
    <HomeCard icon={ListTodo} label="Your work" bodyClass=""
      title={<>My Active Tasks <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular text-slate-700">{tasks.length}</span></>}
      action={list.length > SHOW && <ViewAll onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : 'View all'}</ViewAll>}>
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {[null, ...kinds.map((k) => k.key)].map((k) => (
            <button key={k ?? 'all'} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer ring-1 ${kind === k ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>
              {k ? `${KIND[k].label} ${tasks.filter((t) => t.kind === k).length}` : `All ${tasks.length}`}
            </button>
          ))}
        </div>
      )}
      {isLoading && <div className="space-y-2 px-4 pb-4">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>}
      {error && <p className="px-4 pb-4 text-sm text-rose-700">Tasks could not be loaded. The list refreshes every minute.</p>}
      {!isLoading && !error && !list.length && (
        <div className="flex items-center gap-3 px-4 pb-6 pt-2">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50"><Inbox className="h-5 w-5 text-emerald-600" /></span>
          <div><p className="text-sm font-medium text-slate-800">Nothing is waiting for you</p><p className="text-xs text-slate-500">New work appears here and in the bell as soon as it reaches you.</p></div>
        </div>
      )}
      {shown.length > 0 && (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>{['Priority', 'Task', 'Item / Vendor', 'Due Date', 'Status', 'Action'].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((t) => {
                const { level } = urgencyOf(t);
                const [p, pc, dot] = PRIORITY[level];
                const late = t.dueAt && new Date(t.dueAt) < new Date();
                return (
                  <tr key={`${t.entity}-${t.id}`} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2"><Pill className={pc} dot={dot}>{p}</Pill></td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="font-medium text-slate-900">{t.task}</span>
                      {t.sentBack && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-800"><CornerUpLeft className="h-3 w-3" />Sent back</span>}
                      <span className="block font-mono text-[11px] text-slate-500">{t.docNo}</span>
                    </td>
                    <td className="max-w-44 px-3 py-2">
                      <span className="block truncate text-slate-800">{t.itemCode}</span>
                      <span className="block truncate text-xs text-slate-500">{t.vendorName ?? t.itemDescription}</span>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-xs ${late ? 'font-semibold text-rose-700' : 'text-slate-600'}`}>
                      {t.dueAt ? formatDate(t.dueAt) : <span title={`Waiting since ${formatDate(t.since)}`}>{formatRelative(t.since)}</span>}
                    </td>
                    <td className="px-3 py-2"><Pill className="bg-blue-50 text-blue-700 ring-blue-200" dot="bg-blue-500">{statusOf(t)}</Pill></td>
                    <td className="px-3 py-2">
                      <Link to={t.link} title={`${KIND[t.kind].verb}: ${t.docNo}`} aria-label={`Open ${t.docNo}`}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700">
                        <MoreHorizontal className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </HomeCard>
  );
}

/** Where the task stands, in a few words. */
function statusOf(t) {
  if (t.kind === 'format') return t.status === 'CONFLICT' ? 'Merge conflict' : t.entity === 'ITEM' ? 'Waiting for format' : 'Waiting for approval';
  if (t.kind === 'inspect') return t.sentBack ? 'Sent back' : t.status === 'IN_INSPECTION' ? 'In progress' : 'To inspect';
  if (t.kind === 'review') return t.status === 'WITH_IQC_HEAD' ? 'IQC Head decision' : 'Incharge review';
  if (t.kind === 'capa') return t.status === 'CAPA_SUBMITTED' ? 'CAPA review' : 'Vendor CAPA';
  return t.task;
}

// Colour and icon of a step in "Recently done".
function lookOf(action) {
  if (/REJECT|AUTO_CLOSE/.test(action)) return [XCircle, 'bg-rose-50 text-rose-600'];
  if (/^REVERS/.test(action)) return [History, 'bg-violet-50 text-violet-600'];
  if (/ESCALATE|HOLD|OVERRIDE|SENIOR/.test(action)) return [ShieldAlert, 'bg-orange-50 text-orange-600'];
  if (/APPROVE|VERIFY|CLOSE|ACCEPT/.test(action)) return [CheckCircle2, 'bg-emerald-50 text-emerald-600'];
  if (/SEND_BACK|REVERT|RETURN|RESUBMIT/.test(action)) return [CornerUpLeft, 'bg-amber-50 text-amber-600'];
  return [FileText, 'bg-blue-50 text-blue-600'];
}

/** The user's own last steps, so they can pick up where they left off. */
export function RecentlyDone() {
  const { data: recent } = useGetMyRecentQuery(undefined, { pollingInterval: 120_000 });
  const [all, setAll] = useState(false);
  const list = recent ?? [];
  const shown = all ? list : list.slice(0, 4);
  return (
    <HomeCard icon={History} title="Recently Done by You" bodyClass="" action={list.length > 4 && <ViewAll onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : 'View all'}</ViewAll>}>
      {!list.length && <p className="px-4 pb-6 text-sm text-slate-500">Your workflow steps will show here.</p>}
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {shown.map((r) => {
          const [Icon, tone] = lookOf(r.action);
          return (
            <li key={r.id}>
              <Link to={r.link} className="group flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{HISTORY_LABELS[r.action] ?? r.action}</span>
                  <span className="block truncate text-xs text-slate-500"><span className="font-mono">{r.docNo}</span>{r.itemCode ? ` · ${r.itemCode}` : ''}</span>
                </span>
                <span className="whitespace-nowrap text-[11px] text-slate-400">{formatRelative(r.at)}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-600" />
              </Link>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
