import { ArrowRight, ClipboardCheck, FileWarning, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetMyTasksQuery } from '../api/workflowApi.js';
import { formatDateTime, formatRelative } from '../utils/format.js';
import { DeviationStage } from './deviation/workflowUi.jsx';
import { ImirResult, ImirStatus } from './imir/imirUi.jsx';

/** Every IMIR and deviation waiting for the signed-in user, oldest first. */
export default function MyTasks() {
  const { data: tasks, isLoading, error } = useGetMyTasksQuery(undefined, { pollingInterval: 60_000, refetchOnFocus: true });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-800">My tasks</h2>
        {tasks?.length > 0 && <span className="rounded-full bg-blue-600 text-white text-[11px] font-bold px-2 py-0.5">{tasks.length}</span>}
      </div>
      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <p className="text-sm text-rose-600">Tasks could not be loaded.</p>}
      {tasks?.length === 0 && <p className="flex items-center gap-2 text-sm text-slate-500"><Inbox className="w-4 h-4" />Nothing is waiting for you.</p>}
      {tasks?.length > 0 && (
        <ul className="divide-y divide-slate-100 -mx-2">
          {tasks.map((t) => {
            const Icon = t.entity === 'IMIR' ? ClipboardCheck : FileWarning;
            return (
              <li key={`${t.entity}-${t.id}`}>
                <Link to={t.entity === 'IMIR' ? `/imirs/${t.id}` : `/deviations/${t.id}`} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50">
                  <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{t.task}</span>
                      <span className="font-mono text-xs text-slate-500">{t.docNo}</span>
                      {t.entity === 'IMIR' ? <><ImirStatus status={t.status} /><ImirResult result={t.result} /></> : <DeviationStage stage={t.stage} />}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {t.itemCode} · {t.itemDescription} · {t.vendorName} · plant {t.plantSapCode}{t.department ? ` · ${t.department}` : ''}
                      {t.dueAt && t.stage === 'UNDER_DEVIATION' && <span className="text-amber-700"> · due {formatDateTime(t.dueAt)}</span>}
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">{formatRelative(t.since)}</span>
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
