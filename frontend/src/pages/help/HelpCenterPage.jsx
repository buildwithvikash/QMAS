import { PERMISSIONS } from '@qmas/shared';
import { ArrowRight, Bug, Check, ChevronDown, CircleHelp, Compass, Inbox, KeyRound, Keyboard, LifeBuoy, Lightbulb, RotateCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useGetTicketCountsQuery, useGetTicketsQuery } from '../../api/supportApi.js';
import Badge from '../../components/ui/Badge.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { saveTourState, startTour, TOURS, tourState } from '../../app/tours.js';
import { useAccess } from '../../hooks/useAccess.js';
import { formatRelative } from '../../utils/format.js';
import { HELP_TOPICS } from './helpContent.js';
import { STATUS_VARIANT, openReportIssue, statusOf } from './helpLook.js';

const ACTIONS = [
  { kind: 'BUG', label: 'Report a bug', text: 'Something is broken or shows an error', icon: Bug, tile: 'bg-rose-100 text-rose-600' },
  { kind: 'QUESTION', label: 'Ask a question', text: 'Not sure how to do something', icon: CircleHelp, tile: 'bg-blue-100 text-blue-600' },
  { kind: 'ACCESS', label: 'Request access', text: 'Need a role, plant or page', icon: KeyRound, tile: 'bg-violet-100 text-violet-600' },
  { kind: 'SUGGESTION', label: 'Suggest an idea', text: 'Make QMAS better', icon: Lightbulb, tile: 'bg-emerald-100 text-emerald-600' },
];

const SHORTCUTS = [
  ['Ctrl K', 'Search everything'],
  ['Esc', 'Close a dialog or search'],
  ['Ctrl V', 'Paste a screenshot into a ticket'],
  ['Ctrl F5', 'Reload without the cache'],
];

/** Help Center: search the guides, raise a ticket, and see your recent tickets. */
export default function HelpCenterPage() {
  const { can } = useAccess();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const { data: counts } = useGetTicketCountsQuery('mine');
  const { data: recent } = useGetTicketsQuery({ scope: 'mine', pageSize: 4, sort: 'updatedAt', order: 'desc' });

  const topics = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return HELP_TOPICS.filter((t) => can(t.permission))
      .map((t) => ({
        ...t,
        articles: words.length ? t.articles.filter((a) => words.every((w) => `${t.title} ${a.q} ${a.a}`.toLowerCase().includes(w))) : t.articles,
      }))
      .filter((t) => t.articles.length);
  }, [q, can]);
  const hits = topics.reduce((n, t) => n + t.articles.length, 0);
  const active = (counts?.open ?? 0) + (counts?.inProgress ?? 0) + (counts?.waiting ?? 0);

  return (
    <div>
      <PageHeader icon={LifeBuoy} title="Help Center" subtitle="Guides for every part of QMAS, and a direct line to the support team." />
      <div className="p-5 space-y-5">
        <section className="relative overflow-hidden rounded-2xl border border-blue-100 bg-linear-to-br from-blue-50 via-white to-sky-50 px-6 py-8 sm:px-10">
          <LifeBuoy className="absolute -right-6 -top-6 h-40 w-40 text-blue-100" aria-hidden="true" />
          <h2 className="relative text-2xl font-bold text-slate-900">How can we help?</h2>
          <p className="relative mt-1 text-sm text-slate-500">Search the guides, or tell the support team what is wrong.</p>
          <label className="relative mt-5 block max-w-2xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. forgot password, tablet offline, deviation approval…" aria-label="Search the help guides"
              className="w-full rounded-xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 text-base text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </label>
        </section>

        <div data-tour="help-actions" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ACTIONS.map((a) => (
            <button key={a.kind} type="button" onClick={() => openReportIssue({ kind: a.kind })}
              className="group card flex items-center gap-3 p-4 text-left transition-all hover:-translate-y-px hover:shadow-md cursor-pointer">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${a.tile}`}><a.icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-800">{a.label}</span>
                <span className="block text-xs text-slate-500">{a.text}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" />
            </button>
          ))}
        </div>

        <GuidedTours />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-slate-800">{q ? `${hits} answer${hits === 1 ? '' : 's'} for “${q}”` : 'Guides'}</h2>
              {q && <button type="button" onClick={() => setQ('')} className="text-xs font-medium text-blue-700 hover:underline cursor-pointer">Clear search</button>}
            </div>
            {topics.length === 0 && (
              <div className="card p-8 text-center">
                <p className="text-sm text-slate-600">No guide matches that.</p>
                <button type="button" onClick={() => openReportIssue({ kind: 'QUESTION', title: q })} className="mt-3 text-sm font-semibold text-blue-700 hover:underline cursor-pointer">Ask the support team instead</button>
              </div>
            )}
            {topics.map((t) => (
              <div key={t.key} className="card overflow-hidden">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                  <span className={`grid h-9 w-9 place-items-center rounded-lg ${t.tone}`}><t.icon className="h-4.5 w-4.5" /></span>
                  <h3 className="font-semibold text-slate-800">{t.title}</h3>
                  <span className="ml-auto text-xs text-slate-400">{t.articles.length} article{t.articles.length === 1 ? '' : 's'}</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {t.articles.map((a) => {
                    const id = `${t.key}:${a.q}`;
                    const shown = open === id || (q && hits <= 3);
                    return (
                      <li key={a.q}>
                        <button type="button" aria-expanded={!!shown} onClick={() => setOpen(open === id ? null : id)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                          <span className="flex-1">{a.q}</span>
                          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${shown ? 'rotate-180' : ''}`} />
                        </button>
                        {shown && (
                          <div className="px-4 pb-4 text-sm leading-relaxed text-slate-600">
                            <p>{a.a}</p>
                            {a.to && <Link to={a.to} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">Go there <ArrowRight className="h-3.5 w-3.5" /></Link>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>

          <aside className="space-y-4">
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">My tickets</h2>
                <Link to="/help/tickets" className="text-xs font-semibold text-blue-700 hover:underline">View all</Link>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[['Active', active, 'text-blue-700'], ['Waiting for you', counts?.waiting ?? 0, 'text-amber-600'], ['Resolved', (counts?.resolved ?? 0) + (counts?.closed ?? 0), 'text-emerald-600']].map(([l, n, c]) => (
                  <div key={l} className="rounded-lg bg-slate-50 px-2 py-2">
                    <div className={`text-xl font-bold tabular ${c}`}>{n}</div>
                    <div className="text-[11px] leading-tight text-slate-500">{l}</div>
                  </div>
                ))}
              </div>
              <ul className="mt-3 space-y-1">
                {(recent?.rows ?? []).map((t) => (
                  <li key={t.id}>
                    <Link to={`/help/tickets/${t.id}`} className="block rounded-lg px-2 py-2 hover:bg-slate-50">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-400">{t.ticketNo}</span>
                        <span className="ml-auto"><Badge variant={STATUS_VARIANT[t.status]}>{statusOf(t.status).label}</Badge></span>
                      </div>
                      <div className="truncate text-sm text-slate-700">{t.title}</div>
                      <div className="text-[11px] text-slate-400">Updated {formatRelative(t.updatedAt)}</div>
                    </Link>
                  </li>
                ))}
                {recent && !recent.rows.length && (
                  <li className="flex flex-col items-center gap-1 py-4 text-center text-sm text-slate-500"><Inbox className="h-6 w-6 text-slate-300" />No tickets yet.</li>
                )}
              </ul>
            </div>

            {can(PERMISSIONS.SUPPORT_MANAGE) && (
              <Link to="/help/tickets?scope=all" className="card flex items-center gap-3 border-blue-200 bg-blue-50/50 p-4 hover:bg-blue-50">
                <LifeBuoy className="h-5 w-5 text-blue-700" />
                <span className="flex-1 text-sm font-semibold text-blue-800">Support desk: all tickets</span>
                <ArrowRight className="h-4 w-4 text-blue-700" />
              </Link>
            )}

            <div className="card p-4">
              <h2 className="flex items-center gap-2 font-semibold text-slate-800"><Keyboard className="h-4 w-4 text-slate-400" />Keyboard shortcuts</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {SHORTCUTS.map(([k, d]) => (
                  <li key={k} className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">{d}</span>
                    <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-slate-600">{k}</kbd>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card p-4 text-sm text-slate-600">
              <h2 className="font-semibold text-slate-800">Tips for a quick fix</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Add the IMIR, DN or deviation number.</li>
                <li>Paste a screenshot of what you see.</li>
                <li>Copy the exact error message.</li>
                <li>Say whether others have the same problem.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Every tour the user's role can use, with progress; Start opens the page and runs it. */
function GuidedTours() {
  const { user, can } = useAccess();
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();
  const [state, setState] = useState(() => tourState(user?.id));
  useEffect(() => {
    const onChange = () => setState(tourState(user?.id));
    window.addEventListener('qmas:tours-changed', onChange);
    return () => window.removeEventListener('qmas:tours-changed', onChange);
  }, [user?.id]);
  useEffect(() => {
    if (hash === '#help-tours') setTimeout(() => document.getElementById('help-tours')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }, [hash]);
  const tours = TOURS.filter((t) => can(t.permission));
  const done = tours.filter((t) => state.done.includes(t.key)).length;
  const start = (t) => {
    if (t.startPath && t.startPath !== pathname) {
      navigate(t.startPath);
      setTimeout(() => startTour(t.key), 600);
    } else startTour(t.key);
  };
  return (
    <section id="help-tours" className="card scroll-mt-24">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-100 text-violet-700"><Compass className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900">Guided tours</h2>
          <p className="text-xs text-slate-500">Step-by-step walks through the pages you use. {done} of {tours.length} done.</p>
        </div>
        <span className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-violet-500" style={{ width: `${tours.length ? (done / tours.length) * 100 : 0}%` }} /></span>
        <button type="button" onClick={() => setState(saveTourState(user?.id, { done: [], dismissed: [], offersOff: false }))}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer" title="Mark all as not done and offer them again on each page">
          <RotateCcw className="h-3.5 w-3.5" />Start over
        </button>
      </div>
      {state.offersOff && (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          Tours are not offered automatically.{' '}
          <button type="button" onClick={() => setState(saveTourState(user?.id, { offersOff: false }))} className="font-semibold underline cursor-pointer">Offer them again</button>
        </p>
      )}
      <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {tours.map((t) => {
          const isDone = state.done.includes(t.key);
          return (
            <li key={t.key} className="flex flex-col rounded-xl border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{t.title}</span>
                  <span className="block text-xs text-slate-500">{t.description}</span>
                </span>
                {isDone ? <Badge variant="success"><Check className="h-3 w-3" />Done</Badge> : <Badge variant="info">{t.steps.length} steps</Badge>}
              </div>
              <div className="mt-auto pt-3">
                {t.startPath ? (
                  <button type="button" onClick={() => start(t)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer">
                    <Compass className="h-3.5 w-3.5" />{isDone ? 'Take again' : 'Start tour'}
                  </button>
                ) : <p className="text-[11px] text-slate-500">{t.needs}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
