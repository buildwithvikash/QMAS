import { ArrowRight, CornerUpLeft, Inbox, Tablet, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime, formatRelative } from '../utils/format.js';
import { DeviationStage } from './deviation/workflowUi.jsx';
import { ImirResult } from './imir/imirUi.jsx';
import { byUrgency, KIND, urgencyOf } from './home/taskUi.js';

const EDGE = { overdue: 'bg-rose-500', due: 'bg-amber-400', stale: 'bg-rose-300', waiting: 'bg-amber-200', fresh: 'bg-transparent' };

/** Deadline or waiting time, in words and colour. */
function When({ t }) {
  const { level } = urgencyOf(t);
  if (t.dueAt && (level === 'overdue' || level === 'due')) {
    return (
      <span className={`text-xs font-semibold whitespace-nowrap ${level === 'overdue' ? 'text-rose-700' : 'text-amber-700'}`} title={`Due ${formatDateTime(t.dueAt)}`}>
        {level === 'overdue' ? `Overdue ${formatRelative(t.dueAt).replace(' ago', '')}` : `Due ${formatDateTime(t.dueAt).split(', ').at(-1)}`}
      </span>
    );
  }
  const tone = level === 'stale' ? 'text-rose-700 font-semibold' : level === 'waiting' ? 'text-amber-700 font-medium' : 'text-slate-400';
  return <span className={`text-xs whitespace-nowrap tabular ${tone}`} title={`Waiting since ${formatDateTime(t.since)}`}>{formatRelative(t.since)}</span>;
}

/**
 * The user's work queue: most urgent first (overdue, due today, sent back), then oldest.
 * `kind` narrows it to one kind of work, chosen on the tiles above.
 */
export default function MyTasks({ tasks, isLoading, error, kind, onClearKind }) {
  const list = (tasks ?? []).filter((t) => !kind || t.kind === kind).sort(byUrgency);
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900">{kind ? KIND[kind].long : 'My tasks'}</h2>
        {list.length > 0 && <span className="rounded-full bg-blue-600 text-white text-[11px] font-semibold px-2 py-px tabular">{list.length}</span>}
        {kind && (
          <button type="button" onClick={onClearKind} className="ml-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200 cursor-pointer">
            <X className="w-3 h-3" />Show all
          </button>
        )}
        {list.length > 0 && <span className="ml-auto text-xs text-slate-400">Most urgent first</span>}
      </div>
      {isLoading && <div className="p-4 space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12" />)}</div>}
      {error && <p className="px-4 py-6 text-sm text-rose-700">Tasks could not be loaded. Check the connection; the list refreshes every minute.</p>}
      {!isLoading && !error && list.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-8">
          <span className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center"><Inbox className="w-5 h-5 text-emerald-600" /></span>
          <div>
            <p className="text-sm font-medium text-slate-800">{kind ? 'Nothing of this kind is waiting for you' : 'Nothing is waiting for you'}</p>
            <p className="text-xs text-slate-500">New work appears here and in the bell as soon as it reaches you.</p>
          </div>
        </div>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {list.map((t) => {
            const k = KIND[t.kind];
            const Icon = k.icon;
            const { level } = urgencyOf(t);
            return (
              <li key={`${t.entity}-${t.id}`} className="relative">
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${EDGE[level]}`} aria-hidden="true" />
                <Link to={t.link} className="group flex items-center gap-3 pl-4 pr-3 py-2.5 hover:bg-blue-50/50 transition-colors">
                  <span className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center shrink-0 transition-colors">
                    <Icon className="w-4 h-4 text-slate-500 group-hover:text-blue-700" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-slate-900">{t.task}</span>
                      <span className="text-xs font-mono text-slate-500">{t.docNo}</span>
                      {t.result && <ImirResult result={t.result} />}
                      {t.stage && <DeviationStage stage={t.stage} />}
                      {t.sentBack && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-px text-[11px] font-semibold text-amber-900"><CornerUpLeft className="w-3 h-3" />Sent back</span>}
                      {t.tablet && <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500" title="Checked out to this tablet"><Tablet className="w-3 h-3" />{t.tablet}</span>}
                    </div>
                    <p className="text-xs text-slate-500 truncate">
                      <span className="text-slate-700">{t.itemCode}</span> {t.itemDescription}
                      {t.vendorName && <> · {t.vendorName}</>}
                      {t.department && <> · {t.department}</>}
                      {t.qty && <> · {Number(t.qty).toLocaleString('en-IN')} {t.uom ?? ''}</>}
                      {t.plantSapCode && <> · {t.plantSapCode}</>}
                    </p>
                    {t.note && <p className={`text-xs truncate ${t.sentBack ? 'text-amber-800' : 'text-slate-500'}`}>{t.sentBack ? `“${t.note}”` : t.note}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <When t={t} />
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-blue-700 opacity-0 group-hover:opacity-100 transition-opacity">{k.verb}<ArrowRight className="w-3 h-3" /></span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
