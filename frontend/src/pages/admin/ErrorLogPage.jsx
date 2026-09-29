import { Bug, CheckCircle2, CheckCheck, Globe, RotateCcw, Server, Workflow } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useGetErrorQuery, useGetErrorsQuery, useReopenErrorMutation, useResolveAllErrorsMutation, useResolveErrorMutation } from '../../api/systemApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import PageHeader, { CopyButton, Tabs } from '../../components/ui/PageHeader.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';

const SOURCE = {
  SERVER: { label: 'Server', icon: Server, tile: 'bg-rose-100 text-rose-600' },
  WORKER: { label: 'Worker', icon: Workflow, tile: 'bg-violet-100 text-violet-600' },
  CLIENT: { label: 'Browser', icon: Globe, tile: 'bg-amber-100 text-amber-600' },
};

/** Server errors, worker job failures and browser crashes, grouped, with who hit them and when. */
export default function ErrorLogPage() {
  const [status, setStatus] = useState('open');
  const [source, setSource] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ sort: 'lastSeen', order: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const search = useDebounced(q);
  const { data, isFetching, error } = useGetErrorsQuery({ status, page, pageSize, ...sort, ...(source && { source }), ...(search && { q: search }) }, { pollingInterval: 60_000 });
  const [resolveAll, resolveAllState] = useResolveAllErrorsMutation();

  const columns = [
    {
      key: 'message', header: 'Error', text: (e) => e.message,
      render: (e) => {
        const s = SOURCE[e.source];
        return (
          <div className="flex min-w-0 items-start gap-3">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${s.tile}`} title={s.label}><s.icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="max-w-xl truncate font-semibold text-slate-900" title={e.message}>{e.message}</div>
              <div className="truncate text-xs text-slate-500"><span className="font-medium">{s.label}</span>{e.method ? ` · ${e.method}` : ''}{e.path ? ` · ${e.path}` : ''}{e.statusCode ? ` · ${e.statusCode}` : ''}</div>
            </div>
          </div>
        );
      },
    },
    { key: 'occurrences', header: 'Times', sortable: true, align: 'right', hint: 'How often it happened in total (last 24 hours below).', render: (e) => <div className="text-right"><div className="font-semibold tabular text-slate-900">{e.occurrences}</div><div className="text-[11px] text-slate-400 tabular">{e.last24h} in 24 h</div></div> },
    { key: 'users', header: 'Users', align: 'right', render: (e) => <span className="tabular">{e.users}</span> },
    { key: 'lastSeen', header: 'Last seen', sortable: true, text: (e) => formatDateTime(e.lastSeen), render: (e) => <span title={formatDateTime(e.lastSeen)} className="whitespace-nowrap">{formatRelative(e.lastSeen)}</span> },
    { key: 'firstSeen', header: 'First seen', sortable: true, text: (e) => formatDateTime(e.firstSeen), render: (e) => <span className="whitespace-nowrap text-slate-500">{formatDateTime(e.firstSeen)}</span> },
    { key: 'requestId', header: 'Last reference', text: (e) => e.requestId?.slice(0, 8) ?? '', render: (e) => (e.requestId ? <span className="font-mono text-xs text-slate-600">{e.requestId.slice(0, 8)}</span> : '—') },
    { key: 'status', header: 'Status', text: (e) => (e.resolvedAt ? 'Resolved' : 'Open'), render: (e) => (e.resolvedAt ? <Badge variant="success">Resolved</Badge> : <Badge variant="danger" dot>Open</Badge>) },
  ];

  const doResolveAll = async () => {
    try {
      const r = await resolveAll('Resolved together').unwrap();
      toast.success(`${r.resolved} error${r.resolved === 1 ? '' : 's'} marked resolved`);
      setConfirmAll(false);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader icon={Bug} title="Error Log" subtitle="Server errors, background job failures and crashes in users' browsers. A repeating error is one row; a resolved error that comes back opens again.">
        {status === 'open' && data?.meta?.total > 0 && <Button size="sm" variant="secondary" icon={CheckCheck} onClick={() => setConfirmAll(true)}>Resolve all open</Button>}
      </PageHeader>
      <div className="p-5 space-y-4">
        <Tabs active={status} onChange={(s) => { setStatus(s); setPage(1); }} tabs={[{ key: 'open', label: 'Open' }, { key: 'resolved', label: 'Resolved' }, { key: 'all', label: 'All' }]} />
        <DataTable
          columns={columns}
          rows={data?.rows}
          loading={isFetching}
          error={error}
          activeKey={openId}
          onRowClick={(e) => setOpenId(e.id)}
          sort={sort}
          onSort={(k) => { setSort((s) => ({ sort: k, order: s.sort === k && s.order === 'desc' ? 'asc' : 'desc' })); setPage(1); }}
          selectable
          exportName="error-log"
          empty={status === 'open' ? 'No open errors. All good.' : 'No errors match.'}
          pagination={data?.meta && { meta: data.meta, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }}
          leading={(
            <>
              <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Message, page or reference…" />
              <FilterSelect label="Where" value={source} onChange={(v) => { setSource(v ?? null); setPage(1); }} options={Object.entries(SOURCE).map(([value, s]) => ({ value, label: s.label }))} />
            </>
          )}
        />
      </div>
      {openId && <ErrorDrawer id={openId} onClose={() => setOpenId(null)} />}
      {confirmAll && (
        <ConfirmDialog title="Resolve all open errors?" variant="primary" confirmLabel="Resolve all" busy={resolveAllState.isLoading}
          message="Use this after a fix is deployed. Any error that happens again opens again by itself."
          onConfirm={doResolveAll} onCancel={() => setConfirmAll(false)} />
      )}
    </div>
  );
}

function ErrorDrawer({ id, onClose }) {
  const { data: e, isFetching } = useGetErrorQuery(id);
  const [resolve, resolveState] = useResolveErrorMutation();
  const [reopen, reopenState] = useReopenErrorMutation();
  const [note, setNote] = useState('');
  const s = e ? SOURCE[e.source] : null;
  const max = Math.max(1, ...(e?.daily ?? []).map((d) => d.n));
  const act = async (fn, done) => {
    try {
      await fn();
      toast.success(done);
      setNote('');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <Drawer
      label="Error details"
      title={s ? `${s.label} error` : 'Error'}
      badge={e && (e.resolvedAt ? <Badge variant="success">Resolved</Badge> : <Badge variant="danger" dot>Open</Badge>)}
      subtitle={e ? `${e.occurrences} time${e.occurrences === 1 ? '' : 's'} · last ${formatRelative(e.lastSeen)}` : ''}
      onClose={onClose}
      footer={e && (e.resolvedAt ? (
        <Button variant="secondary" icon={RotateCcw} loading={reopenState.isLoading} onClick={() => act(() => reopen(id).unwrap(), 'Error opened again')}>Open again</Button>
      ) : (
        <div className="flex w-full items-center gap-2">
          <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What fixed it (optional)" maxLength={1000}
            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <Button icon={CheckCircle2} loading={resolveState.isLoading} onClick={() => act(() => resolve({ id, note }).unwrap(), 'Marked resolved')}>Resolve</Button>
        </div>
      ))}
    >
      {!e && isFetching && <p className="text-sm text-slate-500">Loading…</p>}
      {e && (
        <>
          <section className="card p-4">
            <p className="whitespace-pre-wrap wrap-break-word text-sm font-semibold text-slate-900">{e.message}</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              {[
                ['Where', `${s.label}${e.method ? ` · ${e.method}` : ''}${e.path ? ` · ${e.path}` : ''}`],
                ['Status code', e.statusCode],
                ['Last reference', e.requestId && <span className="inline-flex items-center gap-1 font-mono text-xs">{e.requestId}<CopyButton text={e.requestId} label="Copy reference" /></span>],
                ['Last user', e.userName && `${e.userName} (${e.userCode})`],
                ['Browser', e.userAgent && <span className="text-xs">{e.userAgent}</span>],
                ['App version', e.appVersion],
                ['First seen', formatDateTime(e.firstSeen)],
                ['Last seen', formatDateTime(e.lastSeen)],
                e.resolvedAt && ['Resolved', `${formatDateTime(e.resolvedAt)}${e.resolvedByName ? ` by ${e.resolvedByName}` : ''}`],
                e.resolution && ['Fix', e.resolution],
              ].filter((r) => r && r[1]).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2"><dt className="text-slate-500">{k}</dt><dd className="min-w-0 wrap-break-word text-slate-800">{v}</dd></div>
              ))}
            </dl>
          </section>

          {e.daily.length > 0 && (
            <section className="card p-4">
              <h3 className="mb-2 text-xs font-semibold text-slate-600">Last 14 days</h3>
              <div className="flex h-16 items-end gap-1">
                {e.daily.map((d) => (
                  <div key={d.day} className="flex-1 rounded-t bg-rose-400" style={{ height: `${Math.max(8, (d.n / max) * 100)}%` }} title={`${d.day}: ${d.n}`} />
                ))}
              </div>
            </section>
          )}

          {e.detail && (
            <section className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-600">Stack trace</h3>
                <CopyButton text={e.detail} label="Copy stack trace" />
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-white/90 whitespace-pre-wrap">{e.detail}</pre>
            </section>
          )}

          <section className="card p-4">
            <h3 className="mb-2 text-xs font-semibold text-slate-600">Recent occurrences</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {e.events.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-slate-700">{ev.userName ? `${ev.userName} (${ev.userCode})` : 'System'}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(ev.at)}{ev.requestId ? <span className="ml-2 font-mono">{ev.requestId.slice(0, 8)}</span> : null}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </Drawer>
  );
}
