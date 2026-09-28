import {
  ArrowRight, ArrowUpRight, ArrowDownRight, CalendarClock, ChevronDown, Database, Download, ExternalLink, Eye, FilePenLine, FileText, Fingerprint, Hash, RotateCcw,
  ScrollText, Search, ShieldAlert, UserRound, Users,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetAuditActorsQuery, useGetAuditChangesQuery, useGetAuditSummaryQuery, useGetAuditTablesQuery, useGetAuthEventsQuery } from '../../api/adminApi.js';
import { Pagination } from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { formatDateTime, formatRelative, initials } from '../../utils/format.js';

const OPERATIONS = { I: ['Created', 'bg-emerald-50 text-emerald-700 ring-emerald-200'], U: ['Updated', 'bg-blue-50 text-blue-700 ring-blue-200'], D: ['Deleted', 'bg-rose-50 text-rose-700 ring-rose-200'] };
const EVENTS = {
  LOGIN_OK: ['Signed in', 'bg-emerald-50 text-emerald-700 ring-emerald-200'], LOGIN_FAILED: ['Sign-in failed', 'bg-amber-50 text-amber-800 ring-amber-200'],
  LOCKED: ['Locked', 'bg-rose-50 text-rose-700 ring-rose-200'], LOGOUT: ['Signed out', 'bg-slate-100 text-slate-600 ring-slate-200'],
  REFRESH_REUSE: ['Token reuse blocked', 'bg-rose-50 text-rose-700 ring-rose-200'], PASSWORD_CHANGED: ['Password changed', 'bg-blue-50 text-blue-700 ring-blue-200'],
  PASSWORD_RESET: ['Password reset', 'bg-amber-50 text-amber-800 ring-amber-200'], UNLOCKED: ['Unlocked', 'bg-blue-50 text-blue-700 ring-blue-200'],
};
// Book-keeping fields left out of the "Changes" summary (still shown in Before / After).
const QUIET = new Set(['created_at', 'created_by', 'updated_at', 'updated_by', 'row_version', 'id', 'recorded_at']);
const isoDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const DAY = 86_400_000;
const defaults = () => ({ from: isoDay(new Date(Date.now() - 6 * DAY)), to: isoDay(new Date()) });
const show = (v) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Where a changed row can be opened in the app, from its table and key. */
function recordLink(table, pk) {
  const id = String(pk ?? '').split(':')[0];
  const to = {
    'qms.imir': `/imirs/${id}`, 'qms.imir_observation': `/imirs/${id}`, 'qms.imir_checkpoint': `/imirs/${id}`,
    'qms.deviation': `/deviations/${id}`, 'qms.defect_notification': `/dns/${id}`, 'qms.format_version': `/formats/versions/${id}`,
  }[table];
  return to && /^[0-9a-f-]{36}$/i.test(id) ? to : null;
}

/** Changed fields of a row: on update the ones whose value differs, on create / delete every field. */
function changedKeys(r) {
  if (r.operation === 'U') return Object.keys({ ...r.oldData, ...r.newData }).filter((k) => JSON.stringify(r.oldData?.[k]) !== JSON.stringify(r.newData?.[k]));
  return Object.keys(r.newData ?? r.oldData ?? {});
}

function Tile({ icon: Icon, tone, label, value, note, trend }) {
  const tones = { blue: 'bg-blue-100 text-blue-600', green: 'bg-emerald-100 text-emerald-600', amber: 'bg-orange-100 text-orange-500', violet: 'bg-violet-100 text-violet-600' };
  return (
    <div className="card flex items-center gap-4 px-5 py-4">
      <span className={`w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center ${tones[tone]}`}><Icon className="w-7 h-7" /></span>
      <div className="min-w-0">
        <p className="text-sm text-slate-600">{label}</p>
        <p className="flex items-center gap-2 text-2xl font-bold text-slate-900 tabular leading-tight">
          {value ?? '—'}
          {trend !== null && trend !== undefined && (
            <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {trend >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}{Math.abs(trend)}%
            </span>
          )}
        </p>
        <p className="text-xs text-slate-500">{note}</p>
      </div>
    </div>
  );
}

const fieldCls = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500';
const Field = ({ label, children, className = '' }) => (
  <label className={`flex flex-col gap-1 ${className}`}>
    <span className="text-xs font-medium text-slate-500">{label}</span>
    {children}
  </label>
);
const Avatar = ({ name }) => (
  <span className="w-8 h-8 shrink-0 rounded-full bg-blue-900 text-white text-[11px] font-bold flex items-center justify-center">{name ? initials(name) : 'SY'}</span>
);

/** Every change to data and every sign-in event, with who and when: figures, filters, and each change's before / after. */
export default function AuditTrailPage() {
  const [tab, setTab] = useState('changes');
  const [range, setRange] = useState(defaults);
  const [filters, setFilters] = useState({});
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const params = useMemo(() => ({
    from: `${range.from}T00:00:00+05:30`,
    to: new Date(new Date(`${range.to}T00:00:00+05:30`).getTime() + DAY).toISOString(),
  }), [range]);
  const { data: summary } = useGetAuditSummaryQuery(params);
  const { data: actors } = useGetAuditActorsQuery(params);
  const { data: tables } = useGetAuditTablesQuery();
  const listParams = { ...params, page, pageSize, ...(q && { q }), ...(filters.actorId && { actorId: filters.actorId }) };
  const changes = useGetAuditChangesQuery({ ...listParams, ...(filters.table && { table: filters.table }), ...(filters.operation && { operation: filters.operation }) }, { skip: tab !== 'changes' });
  const auth = useGetAuthEventsQuery({ ...listParams, ...(filters.event && { event: filters.event }) }, { skip: tab !== 'auth' });
  const current = tab === 'changes' ? changes : auth;

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v || undefined })); setPage(1); };
  const reset = () => { setRange(defaults()); setFilters({}); setText(''); setQ(''); setPage(1); };
  const exportUrl = `/api/v1/audit/${tab === 'changes' ? 'changes' : 'auth-events'}?${new URLSearchParams(Object.entries({
    ...params, format: 'csv', ...(q && { q }), ...(filters.actorId && { actorId: filters.actorId }),
    ...(tab === 'changes' ? { ...(filters.table && { table: filters.table }), ...(filters.operation && { operation: filters.operation }) } : { ...(filters.event && { event: filters.event }) }),
  }))}`;
  const pct = (n) => (summary?.total ? `${Math.round((n / summary.total) * 100)}% of total` : '—');

  return (
    <div>
      <PageHeader icon={ScrollText} title="Audit Trail" subtitle="Track every change to data and every sign-in event, with who and when.">
        <a href={exportUrl} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="w-4 h-4" />Export</a>
      </PageHeader>
      <div className="p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={FileText} tone="blue" label="Total Events" value={summary?.total.toLocaleString('en-IN')} trend={summary?.trendPct} note="in selected period" />
          <Tile icon={FilePenLine} tone="green" label="Data Changes" value={summary?.dataChanges.toLocaleString('en-IN')} note={pct(summary?.dataChanges ?? 0)} />
          <Tile icon={Users} tone="amber" label="Sign-in Events" value={summary?.signInEvents.toLocaleString('en-IN')} note={summary?.securityAlerts ? `${pct(summary.signInEvents)} · ${summary.securityAlerts} failed or blocked` : pct(summary?.signInEvents ?? 0)} />
          <Tile icon={UserRound} tone="violet" label="Unique Users" value={summary?.uniqueUsers} note="in selected period" />
        </div>

        <section className="card p-4">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[9.5rem_9.5rem_repeat(3,minmax(0,1fr))_minmax(0,1.6fr)_auto] items-end"
            onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); setPage(1); }}>
            <Field label="From Date"><input type="date" className={fieldCls} value={range.from} max={range.to} onChange={(e) => { if (e.target.value) { setRange((r) => ({ ...r, from: e.target.value })); setPage(1); } }} /></Field>
            <Field label="To Date"><input type="date" className={fieldCls} value={range.to} min={range.from} onChange={(e) => { if (e.target.value) { setRange((r) => ({ ...r, to: e.target.value })); setPage(1); } }} /></Field>
            {tab === 'changes' ? (
              <>
                <Field label="Table">
                  <select className={`${fieldCls} cursor-pointer`} value={filters.table ?? ''} onChange={(e) => setFilter('table', e.target.value)}>
                    <option value="">All tables</option>{(tables ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Action">
                  <select className={`${fieldCls} cursor-pointer`} value={filters.operation ?? ''} onChange={(e) => setFilter('operation', e.target.value)}>
                    <option value="">All actions</option>{Object.entries(OPERATIONS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
              </>
            ) : (
              <Field label="Event" className="lg:col-span-2">
                <select className={`${fieldCls} cursor-pointer`} value={filters.event ?? ''} onChange={(e) => setFilter('event', e.target.value)}>
                  <option value="">All events</option>{Object.entries(EVENTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            )}
            <Field label="User">
              <select className={`${fieldCls} cursor-pointer`} value={filters.actorId ?? ''} onChange={(e) => setFilter('actorId', e.target.value)}>
                <option value="">All users</option>{(actors ?? []).map((a) => <option key={a.id} value={a.id}>{a.fullName} ({a.employeeCode})</option>)}
              </select>
            </Field>
            <Field label=" ">
              <span className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tab === 'changes' ? 'Search in record (e.g. IMIR, value, decision…)' : 'Search user, IP, device…'} aria-label="Search" className={`${fieldCls} pl-9`} />
              </span>
            </Field>
            <div className="flex gap-2">
              <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"><RotateCcw className="w-4 h-4" />Reset</button>
              <button type="submit" className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer"><Search className="w-4 h-4" />Search</button>
            </div>
          </form>
        </section>

        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200">
          <div role="tablist" className="flex gap-1">
            {[['changes', 'Data changes', FilePenLine], ['auth', 'Sign-in events', Users]].map(([k, l, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setPage(1); }}
                className={`inline-flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 text-sm cursor-pointer ${tab === k ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                <Icon className="w-4 h-4" />{l}
                <span className="rounded-full bg-slate-100 px-1.5 text-[11px] tabular text-slate-600">{k === 'changes' ? summary?.dataChanges ?? '' : summary?.signInEvents ?? ''}</span>
              </button>
            ))}
          </div>
          <label className="ml-auto mb-1.5 flex items-center gap-2 text-sm text-slate-600">Show
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-9 rounded-lg border border-slate-200 bg-white px-2 cursor-pointer">
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>rows
          </label>
        </div>

        {tab === 'changes'
          ? <ChangesTable rows={changes.data?.rows} loading={changes.isFetching} error={changes.error} offset={(page - 1) * pageSize} meta={changes.data?.meta} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          : <AuthTable rows={auth.data?.rows} loading={auth.isFetching} error={auth.error} offset={(page - 1) * pageSize} meta={auth.data?.meta} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
        {current.data?.meta?.total > 0 && <p className="text-xs text-slate-400">Export downloads every matching row of the period as CSV (up to 20,000).</p>}
      </div>
    </div>
  );
}

const th = 'px-3 py-3 text-left text-xs font-semibold text-slate-600 whitespace-nowrap';

function Shell({ loading, error, empty, rows, colSpan, head, children, meta, onPage, onPageSize }) {
  return (
    <section className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200"><tr>{head}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !rows && [1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={colSpan} className="px-4 py-3"><div className="skeleton h-8" /></td></tr>)}
            {error && <tr><td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-rose-600">Could not load the audit trail.</td></tr>}
            {rows && !rows.length && <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-500">{empty}</td></tr>}
            {children}
          </tbody>
        </table>
      </div>
      <Pagination meta={meta} onPage={onPage} onPageSize={onPageSize} inCard />
    </section>
  );
}

function ChangesTable({ rows, loading, error, offset, meta, onPage, onPageSize }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const head = ['#', 'When', 'Action', 'Table', 'Changed By', 'Changes', ''].map((h, i) => <th key={i} className={`${th} ${i === 6 ? 'text-right' : ''}`}>{h || 'Actions'}</th>);
  return (
    <Shell loading={loading} error={error} rows={rows} colSpan={7} head={head} meta={meta} onPage={onPage} onPageSize={onPageSize} empty="No changes match these filters in this period.">
      {(rows ?? []).map((r, i) => {
        const keys = changedKeys(r);
        const summaryKeys = keys.filter((k) => !QUIET.has(k));
        const isOpen = open.has(r.id);
        const [label, tone] = OPERATIONS[r.operation];
        return (
          <Fragment key={r.id}>
            <tr className={`align-top ${isOpen ? 'bg-blue-50/40 shadow-[inset_3px_0_0_#2563eb]' : 'hover:bg-slate-50/70'}`}>
              <td className="px-3 py-3 text-slate-500 tabular">{offset + i + 1}</td>
              <td className="px-3 py-3 whitespace-nowrap"><span className="block text-slate-900 tabular">{formatDateTime(r.changedAt)}</span><span className="text-xs text-slate-500">{formatRelative(r.changedAt)}</span></td>
              <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${tone}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{label}</span></td>
              <td className="px-3 py-3 font-mono text-xs text-slate-700">{r.tableName}</td>
              <td className="px-3 py-3">
                <span className="flex items-center gap-2.5">
                  <Avatar name={r.actorName} />
                  <span><span className="block font-medium text-slate-900">{r.actorName ?? 'System'}</span>{r.actorEmployeeCode && <span className="text-xs text-slate-500">({r.actorEmployeeCode})</span>}</span>
                </span>
              </td>
              <td className="px-3 py-3 font-mono text-xs">
                <ul className="space-y-0.5 max-w-lg">
                  {(summaryKeys.length ? summaryKeys : keys).slice(0, 4).map((k) => (
                    <li key={k} className="break-all">
                      <span className="text-slate-600">{k}:</span>{' '}
                      {r.operation === 'U' ? (
                        <><span className="rounded bg-rose-50 px-1 text-rose-700">{show(r.oldData?.[k])}</span> → <span className="rounded bg-emerald-50 px-1 text-emerald-700">{show(r.newData?.[k])}</span></>
                      ) : <span className="text-slate-800">{show((r.newData ?? r.oldData)?.[k])}</span>}
                    </li>
                  ))}
                  {(summaryKeys.length || keys.length) > 4 && <li><span className="rounded bg-slate-100 px-1.5 py-0.5 font-sans text-[11px] text-slate-600">+{(summaryKeys.length || keys.length) - 4} more fields</span></li>}
                  {!keys.length && <li className="text-slate-400">—</li>}
                </ul>
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap">
                <button type="button" onClick={() => toggle(r.id)} title="Before / after" aria-label="Show before and after" className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 cursor-pointer"><Eye className="w-4 h-4" /></button>
                <button type="button" onClick={() => toggle(r.id)} aria-expanded={isOpen} aria-label={isOpen ? 'Collapse' : 'Expand'} className="ml-1 p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"><ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></button>
              </td>
            </tr>
            {isOpen && (
              <tr className="bg-blue-50/20 shadow-[inset_3px_0_0_#2563eb]">
                <td colSpan={7} className="px-4 pb-4 pt-1">
                  <ChangeDetail r={r} keys={keys} />
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </Shell>
  );
}

/** Before and after of one change, with the changed fields highlighted, and where it happened. */
function ChangeDetail({ r, keys }) {
  const changed = new Set(keys);
  const panel = (title, data, tone) => (
    <div className={`min-w-0 rounded-xl border p-3 ${tone === 'old' ? 'border-rose-200 bg-rose-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}>
      <p className={`mb-1.5 text-sm font-bold ${tone === 'old' ? 'text-rose-700' : 'text-emerald-700'}`}>{title}</p>
      {data ? (
        <pre className="overflow-x-auto text-xs leading-5 text-slate-700">
          {'{\n'}
          {Object.entries(data).map(([k, v]) => (
            <span key={k} className={changed.has(k) && r.operation === 'U' ? (tone === 'old' ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold') : ''}>
              {`  "${k}": ${JSON.stringify(v)},\n`}
            </span>
          ))}
          {'}'}
        </pre>
      ) : <p className="text-xs text-slate-500">{tone === 'old' ? 'Nothing before: the record was created here.' : 'Nothing after: the record was deleted here.'}</p>}
    </div>
  );
  const link = recordLink(r.tableName, r.rowPk);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_18rem] items-stretch">
      {panel('Before', r.oldData, 'old')}
      <span className="hidden lg:flex items-center"><span className="w-8 h-8 rounded-full border border-blue-300 bg-white text-blue-600 flex items-center justify-center"><ArrowRight className="w-4 h-4" /></span></span>
      {panel('After', r.newData, 'new')}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-sm font-bold text-slate-900">Additional Info</p>
        <dl className="space-y-2 text-xs">
          {[
            [Hash, 'Record ID', `${r.tableName}#${r.rowPk}`], [Database, 'Table', r.tableName],
            [UserRound, 'Changed By', `${r.actorName ?? 'System'}${r.actorEmployeeCode ? ` (${r.actorEmployeeCode})` : ''}`], [CalendarClock, 'Changed On', formatDateTime(r.changedAt)],
            [Fingerprint, 'Request', r.requestId ? r.requestId.slice(0, 8) : '—'],
          ].map(([Icon, k, v]) => (
            <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2"><dt className="flex items-center gap-1.5 text-slate-600"><Icon className="w-3.5 h-3.5" />{k}</dt><dd className="text-slate-800 break-all">{v}</dd></div>
          ))}
        </dl>
        {r.operation === 'U' && <p className="mt-2 text-[11px] text-slate-400">Updates record only the fields that changed.</p>}
        {link && <Link to={link} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">Open the record<ExternalLink className="w-3 h-3" /></Link>}
      </div>
    </div>
  );
}

/** "Chrome on Windows" from a user-agent string (enough to recognise a device). */
function device(ua) {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|axios|curl|supertest/i.test(ua) ? 'Script' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function AuthTable({ rows, loading, error, offset, meta, onPage, onPageSize }) {
  const head = ['#', 'When', 'Event', 'User', 'IP address', 'Device', 'Detail'].map((h) => <th key={h} className={th}>{h}</th>);
  return (
    <Shell loading={loading} error={error} rows={rows} colSpan={7} head={head} meta={meta} onPage={onPage} onPageSize={onPageSize} empty="No sign-in events match these filters in this period.">
      {(rows ?? []).map((r, i) => {
        const [label, tone] = EVENTS[r.event] ?? [r.event, 'bg-slate-100 text-slate-600 ring-slate-200'];
        const alert = ['LOGIN_FAILED', 'LOCKED', 'REFRESH_REUSE'].includes(r.event);
        return (
          <tr key={r.id} className={alert ? 'bg-rose-50/30' : 'hover:bg-slate-50/70'}>
            <td className="px-3 py-3 text-slate-500 tabular">{offset + i + 1}</td>
            <td className="px-3 py-3 whitespace-nowrap"><span className="block text-slate-900 tabular">{formatDateTime(r.at)}</span><span className="text-xs text-slate-500">{formatRelative(r.at)}</span></td>
            <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${tone}`}>{alert && <ShieldAlert className="w-3 h-3" />}{label}</span></td>
            <td className="px-3 py-3">
              <span className="flex items-center gap-2.5"><Avatar name={r.fullName} /><span><span className="block font-medium text-slate-900">{r.fullName ?? 'Unknown user'}</span><span className="text-xs text-slate-500">({r.employeeCode ?? 'unknown'})</span></span></span>
            </td>
            <td className="px-3 py-3 font-mono text-xs text-slate-700">{r.ip ?? '—'}</td>
            <td className="px-3 py-3 text-xs text-slate-600" title={r.userAgent ?? ''}>{device(r.userAgent)}</td>
            <td className="px-3 py-3 text-xs text-slate-600">{r.detail?.reason ? r.detail.reason.replaceAll('_', ' ').toLowerCase() : r.detail ? Object.entries(r.detail).map(([k, v]) => `${k}: ${show(v)}`).join(', ') : '—'}</td>
          </tr>
        );
      })}
    </Shell>
  );
}
