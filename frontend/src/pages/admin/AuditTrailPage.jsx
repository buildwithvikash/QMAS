import { ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useGetAuditChangesQuery, useGetAuditTablesQuery, useGetAuthEventsQuery } from '../../api/adminApi.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable, { Pagination } from '../../components/ui/DataTable.jsx';
import { Select, TextInput } from '../../components/ui/fields.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { formatDateTime } from '../../utils/format.js';

const OPERATIONS = { I: ['Created', 'success'], U: ['Updated', 'info'], D: ['Deleted', 'danger'] };
const EVENTS = {
  LOGIN_OK: ['Signed in', 'success'], LOGIN_FAILED: ['Sign-in failed', 'warning'], LOCKED: ['Locked', 'danger'], LOGOUT: ['Signed out', 'neutral'],
  REFRESH_REUSE: ['Token reuse blocked', 'danger'], PASSWORD_CHANGED: ['Password changed', 'info'], PASSWORD_RESET: ['Password reset', 'warning'], UNLOCKED: ['Unlocked', 'info'],
};

// YYYY-MM-DD of the IST calendar day.
const isoDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const today = new Date();

/** Date inputs are IST calendar days; the API takes an instant range [from, to). */
function useRange() {
  const [from, setFrom] = useState(isoDay(new Date(today.getTime() - 6 * 86_400_000)));
  const [to, setTo] = useState(isoDay(today));
  const params = useMemo(() => ({
    from: `${from}T00:00:00+05:30`,
    to: new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString(),
  }), [from, to]);
  return { from, to, setFrom, setTo, params };
}

export default function AuditTrailPage() {
  const [tab, setTab] = useState('changes');
  return (
    <div>
      <PageHeader icon={ScrollText} title="Audit Trail" subtitle="Every change to data and every sign-in event, with who and when" />
      <div className="p-5">
        <Tabs tabs={[{ key: 'changes', label: 'Data changes' }, { key: 'auth', label: 'Sign-in events' }]} active={tab} onChange={setTab} />
        {tab === 'changes' ? <Changes /> : <AuthEvents />}
      </div>
    </div>
  );
}

function RangeInputs({ range }) {
  return (
    <>
      <TextInput className="w-40" label="From" type="date" max={range.to} value={range.from} onChange={(e) => e.target.value && range.setFrom(e.target.value)} />
      <TextInput className="w-40" label="To" type="date" min={range.from} value={range.to} onChange={(e) => e.target.value && range.setTo(e.target.value)} />
    </>
  );
}

function Changes() {
  const range = useRange();
  const [table, setTable] = useState(null);
  const [operation, setOperation] = useState(null);
  const [page, setPage] = useState(1);
  const { data: tables } = useGetAuditTablesQuery();
  const params = { ...range.params, page, pageSize: 50, ...(table && { table }), ...(operation && { operation }) };
  const { data, isFetching, error } = useGetAuditChangesQuery(params);

  const columns = [
    { key: 'changedAt', header: 'When', render: (r) => <span className="whitespace-nowrap tabular">{formatDateTime(r.changedAt)}</span> },
    { key: 'operation', header: 'Action', render: (r) => <Badge variant={OPERATIONS[r.operation][1]}>{OPERATIONS[r.operation][0]}</Badge> },
    { key: 'tableName', header: 'Record', render: (r) => <span className="font-mono text-xs">{r.tableName} #{r.rowPk}</span> },
    { key: 'actor', header: 'By', render: (r) => (r.actorName ? <span>{r.actorName} <span className="text-slate-400">({r.actorEmployeeCode})</span></span> : <span className="text-slate-400">System</span>) },
    { key: 'changes', header: 'Changes', render: (r) => <ChangeList row={r} /> },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <RangeInputs range={range} />
        <Select className="w-56" label="Table" placeholder="All tables" value={table} onChange={(v) => { setTable(v); setPage(1); }} options={(tables ?? []).map((t) => ({ value: t, label: t }))} />
        <Select className="w-40" label="Action" placeholder="All actions" value={operation} onChange={(v) => { setOperation(v); setPage(1); }} options={Object.entries(OPERATIONS).map(([k, [l]]) => ({ value: k, label: l }))} />
      </div>
      <DataTable columns={columns} rows={data?.rows} loading={isFetching} error={error} empty="No changes in this period." />
      <Pagination meta={data?.meta} onPage={setPage} />
    </>
  );
}

const show = (v) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function ChangeList({ row }) {
  const keys = Object.keys(row.newData ?? row.oldData ?? {}).filter((k) => !['created_at', 'created_by', 'id'].includes(k));
  if (keys.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <ul className="text-xs space-y-0.5 max-w-xl">
      {keys.slice(0, 8).map((k) => (
        <li key={k} className="break-words">
          <span className="font-mono text-slate-500">{k}</span>:{' '}
          {row.operation === 'U' ? (
            <>
              <span className="text-rose-600 line-through">{show(row.oldData?.[k])}</span> → <span className="text-emerald-700">{show(row.newData?.[k])}</span>
            </>
          ) : (
            <span className="text-slate-700">{show((row.newData ?? row.oldData)[k])}</span>
          )}
        </li>
      ))}
      {keys.length > 8 && <li className="text-slate-400">+{keys.length - 8} more fields</li>}
    </ul>
  );
}

function AuthEvents() {
  const range = useRange();
  const [event, setEvent] = useState(null);
  const [page, setPage] = useState(1);
  const { data, isFetching, error } = useGetAuthEventsQuery({ ...range.params, page, pageSize: 50, ...(event && { event }) });
  const columns = [
    { key: 'at', header: 'When', render: (r) => <span className="whitespace-nowrap tabular">{formatDateTime(r.at)}</span> },
    { key: 'event', header: 'Event', render: (r) => <Badge variant={EVENTS[r.event]?.[1] ?? 'neutral'}>{EVENTS[r.event]?.[0] ?? r.event}</Badge> },
    { key: 'user', header: 'User', render: (r) => <span>{r.fullName ?? '—'} <span className="text-slate-400">({r.employeeCode ?? 'unknown'})</span></span> },
    { key: 'ip', header: 'IP address', render: (r) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
    { key: 'detail', header: 'Detail', render: (r) => <span className="text-xs text-slate-500">{r.detail?.reason?.replaceAll('_', ' ').toLowerCase() ?? ''}</span> },
  ];
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <RangeInputs range={range} />
        <Select className="w-56" label="Event" placeholder="All events" value={event} onChange={(v) => { setEvent(v); setPage(1); }} options={Object.entries(EVENTS).map(([k, [l]]) => ({ value: k, label: l }))} />
      </div>
      <DataTable columns={columns} rows={data?.rows} loading={isFetching} error={error} empty="No sign-in events in this period." />
      <Pagination meta={data?.meta} onPage={setPage} />
    </>
  );
}
