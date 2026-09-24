import { ClipboardCheck, FileWarning, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetMyTasksQuery } from '../api/workflowApi.js';
import { formatDateTime, formatRelative } from '../utils/format.js';
import { DeviationStage } from './deviation/workflowUi.jsx';
import { ImirResult } from './imir/imirUi.jsx';

const DAY = 86_400_000;

/** How long a task has waited, coloured once it is a day (amber) or three days (red) old. */
function Age({ since }) {
  const waited = Date.now() - new Date(since).getTime();
  const tone = waited > 3 * DAY ? 'text-rose-700 font-semibold' : waited > DAY ? 'text-amber-700 font-medium' : 'text-slate-400';
  return <span className={`text-xs whitespace-nowrap tabular ${tone}`} title={`Waiting since ${formatDateTime(since)}`}>{formatRelative(since)}</span>;
}

/** Every IMIR and deviation waiting for the signed-in user, oldest first: the user's work queue. */
export default function MyTasks() {
  const { data: tasks, isLoading, error } = useGetMyTasksQuery(undefined, { pollingInterval: 60_000, refetchOnFocus: true });
  return (
    <section className="card">
      <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-slate-100">
        <h2 className="text-base font-semibold text-slate-900">My tasks</h2>
        {tasks?.length > 0 && <span className="rounded-full bg-blue-600 text-white text-xs font-semibold px-2 py-0.5 tabular">{tasks.length}</span>}
        {tasks?.length > 0 && <span className="ml-auto text-xs text-slate-500">Oldest first</span>}
      </div>
      {isLoading && <div className="p-5 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div>}
      {error && <p className="px-5 py-6 text-sm text-rose-700">Tasks could not be loaded. Check the connection; the list refreshes every minute.</p>}
      {tasks?.length === 0 && (
        <div className="flex items-center gap-3 px-5 py-8">
          <span className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center"><Inbox className="w-5 h-5 text-emerald-600" /></span>
          <div>
            <p className="text-sm font-medium text-slate-800">Nothing is waiting for you</p>
            <p className="text-xs text-slate-500">New work appears here and in the bell as soon as it reaches you.</p>
          </div>
        </div>
      )}
      {tasks?.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {tasks.map((t) => {
            const Icon = t.entity === 'IMIR' ? ClipboardCheck : FileWarning;
            return (
              <li key={`${t.entity}-${t.id}`}>
                <Link to={t.entity === 'IMIR' ? `/imirs/${t.id}` : `/deviations/${t.id}`} className="group flex items-start gap-3 px-5 py-3.5 hover:bg-blue-50/40 transition-colors">
                  <span className="mt-0.5 w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center shrink-0 transition-colors">
                    <Icon className="w-4 h-4 text-slate-500 group-hover:text-blue-700" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-slate-900">{t.task}</span>
                      <span className="text-xs text-slate-500 tabular">{t.docNo}</span>
                      {t.entity === 'IMIR' ? <ImirResult result={t.result} /> : <DeviationStage stage={t.stage} />}
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      <span className="text-slate-700">{t.itemCode}</span> {t.itemDescription}, from {t.vendorName}
                      {t.department ? ` (${t.department})` : ''}
                    </p>
                    {t.dueAt && t.stage === 'UNDER_DEVIATION' && <p className="text-xs text-amber-700 mt-0.5">Quantities due {formatDateTime(t.dueAt)}</p>}
                  </div>
                  <Age since={t.since} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
