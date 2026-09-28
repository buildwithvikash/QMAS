import { sapMockLotSchema } from '@qmas/shared';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, CheckCircle2, CircleAlert, ClipboardCheck, DatabaseZap, Download, ExternalLink, FileText, Info, MoreVertical,
  PackageOpen, Play, RefreshCw, Search, Settings, Timer, Wifi, WifiOff, XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import {
  useAddMockLotMutation, useGetSapRunQuery, useGetSapRunsQuery, useGetSapStartersQuery, useGetSapSummaryQuery, useRunSapSyncMutation,
} from '../../api/imirApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer, { DrawerCard } from '../../components/ui/Drawer.jsx';
import { FormError, Select, TextInput } from '../../components/ui/fields.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import PopMenu from '../../components/ui/PopMenu.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatDate, formatDateTime, formatQty, formatRelative } from '../../utils/format.js';
import { ImirStatus } from '../imir/imirUi.jsx';

const RUN = {
  OK: ['OK', 'bg-emerald-50 text-emerald-700 ring-emerald-200', 'bg-emerald-500'],
  PARTIAL: ['Partial', 'bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-500'],
  FAILED: ['Failed', 'bg-rose-50 text-rose-700 ring-rose-200', 'bg-rose-500'],
  RUNNING: ['Running', 'bg-blue-50 text-blue-700 ring-blue-200', 'bg-blue-500 animate-pulse'],
};
const STATE = {
  CONNECTED: ['Connected', 'bg-emerald-100 text-emerald-700', Wifi, 'text-emerald-600 bg-emerald-100'],
  DELAYED: ['Delayed', 'bg-amber-100 text-amber-800', Timer, 'text-amber-600 bg-amber-100'],
  FAILING: ['Failing', 'bg-rose-100 text-rose-700', WifiOff, 'text-rose-600 bg-rose-100'],
  NEVER: ['Not run yet', 'bg-slate-100 text-slate-600', WifiOff, 'text-slate-500 bg-slate-100'],
};
const DAY = 86_400_000;
const isoDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const duration = (s) => (s === null || s === undefined ? '—' : s < 1 ? '<1s' : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);
const inputCls = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500';

function Trend({ value }) {
  if (value === null || value === undefined) return null;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
      {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}{Math.abs(value)}%
    </span>
  );
}

function Tile({ icon: Icon, tone, label, children, note }) {
  return (
    <div className="card flex items-start gap-4 px-4 py-4">
      <span className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center ${tone}`}><Icon className="w-6 h-6" /></span>
      <div className="min-w-0">
        <p className="text-sm text-slate-600">{label}</p>
        <div className="mt-0.5">{children}</div>
        {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
      </div>
    </div>
  );
}

/** SAP QA32 pulls: health and figures, every pull with filters and export, a pull's lots, manual pull and (mock mode) simulated lots. */
export default function SapSyncPage() {
  const [range, setRange] = useState(() => ({ from: isoDay(new Date(Date.now() - 6 * DAY)), to: isoDay(new Date()) }));
  const [status, setStatus] = useState('');
  const [by, setBy] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dialog, setDialog] = useState(null); // 'simulate' | 'settings'
  const [detail, setDetail] = useState(null);
  const navigate = useNavigate();
  const params = useMemo(() => ({
    from: `${range.from}T00:00:00+05:30`,
    to: new Date(new Date(`${range.to}T00:00:00+05:30`).getTime() + DAY).toISOString(),
    page, pageSize, ...(status && { status }), ...(by && { by }), ...(q && { q }),
  }), [range, page, pageSize, status, by, q]);
  const { data: s } = useGetSapSummaryQuery(undefined, { pollingInterval: 30_000 });
  const { data, isFetching, error, refetch } = useGetSapRunsQuery(params, { pollingInterval: 30_000 });
  const { data: starters } = useGetSapStartersQuery();
  const [run, { isLoading: pulling }] = useRunSapSyncMutation();
  const { from: _f, to: _t, page: _p, pageSize: _ps, ...exportFilters } = params;
  const exportUrl = `/api/v1/integration/sap/runs?${new URLSearchParams({ from: params.from, to: params.to, ...exportFilters, format: 'csv' })}`;

  const pull = async () => {
    try {
      const r = await run().unwrap();
      toast.success(`Pulled ${r.fetched} lot(s): ${r.createdLots} new, ${r.openedImirs} IMIR(s) opened${r.errors.length ? `, ${r.errors.length} failed` : ''}`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  const mock = s?.mode === 'mock';
  const [stateLabel, stateTone, StateIcon, stateTile] = STATE[s?.state ?? 'NEVER'];
  const last = s?.last;

  const rows = data?.rows?.map((r, i) => ({ ...r, rowNo: (page - 1) * pageSize + i + 1 }));
  const columns = [
    { key: 'rowNo', header: '#', text: (r) => r.rowNo, render: (r) => <span className="text-slate-500 tabular">{r.rowNo}</span> },
    { key: 'startedAt', header: 'Started', text: (r) => formatDateTime(r.startedAt), render: (r) => <span className="whitespace-nowrap text-slate-900" title={formatRelative(r.startedAt)}>{formatDateTime(r.startedAt)}</span> },
    {
      key: 'status', header: 'Status', text: (r) => RUN[r.status][0],
      render: (r) => <span className="inline-flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${RUN[r.status][2]}`} /><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${RUN[r.status][1]}`}>{RUN[r.status][0]}</span></span>,
    },
    { key: 'fetched', header: 'Lots read', align: 'right', render: (r) => <span className="tabular">{r.fetched}</span> },
    { key: 'createdLots', header: 'New', align: 'right', render: (r) => <span className={`tabular ${r.createdLots ? 'font-semibold text-blue-700' : ''}`}>{r.createdLots}</span> },
    { key: 'openedImirs', header: 'IMIRs opened', align: 'right', render: (r) => <span className={`tabular ${r.openedImirs ? 'font-semibold text-emerald-700' : ''}`}>{r.openedImirs}</span> },
    { key: 'by', header: 'Started by', text: (r) => r.triggeredByName ?? 'Scheduler', render: (r) => <span className="text-slate-800">{r.triggeredByName ?? 'Scheduler'}</span> },
    {
      key: 'errors', header: 'Problems', text: (r) => (r.errors ?? []).map((e) => `${e.sapLotNo ? `Lot ${e.sapLotNo}: ` : ''}${e.message}`).join(' | '),
      render: (r) => (r.errors?.length ? (
        <span className="inline-flex items-start gap-1.5 text-xs text-rose-700 max-w-72"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span className="truncate">{r.errors.length > 1 ? `${r.errors.length} lots: ` : ''}{r.errors[0].message}</span></span>
      ) : <span className="text-slate-300">—</span>),
    },
    { key: 'durationSec', header: 'Duration', align: 'right', text: (r) => r.durationSec, render: (r) => <span className="tabular text-slate-700">{duration(r.durationSec)}</span> },
  ];
  const rowMenu = (r) => [
    { label: 'Details', icon: FileText, onClick: () => setDetail(r.id) },
    ...(r.createdLots ? [{ label: 'Incoming lots', icon: PackageOpen, onClick: () => navigate('/imirs') }] : []),
  ];

  return (
    <div>
      <PageHeader icon={DatabaseZap} title={<span className="inline-flex items-center gap-2">SAP Sync<span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${stateTone}`}>{stateLabel}{mock ? ' (Mock)' : ''}</span></span>}
        subtitle={`Inward lots from QA32${mock ? ' adapter (mock: SAP API not connected yet)' : ''}. The worker pulls automatically every ${s?.intervalMin ?? '…'} minutes.`}>
        <Button size="sm" variant="secondary" icon={Settings} onClick={() => setDialog('settings')}>Sync Settings</Button>
        {mock && <Button size="sm" variant="secondary" icon={Play} onClick={() => setDialog('simulate')} className="text-blue-700! border-blue-300!">Simulate inward lot</Button>}
        <Button size="sm" icon={RefreshCw} loading={pulling} onClick={pull}>Pull now</Button>
        <Kebab items={[
          { label: 'Export pulls (CSV)', icon: Download, href: exportUrl },
          { label: 'Incoming lots', icon: PackageOpen, onClick: () => navigate('/imirs') },
        ]} />
      </PageHeader>

      <div className="p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Tile icon={Boxes} tone="bg-emerald-100 text-emerald-600" label="Last Sync"
            note={last ? (
              <span className={`inline-flex items-center gap-1 font-medium ${last.status === 'OK' ? 'text-emerald-700' : last.status === 'FAILED' ? 'text-rose-700' : 'text-amber-700'}`}>
                {last.status === 'OK' ? <CheckCircle2 className="w-3.5 h-3.5" /> : last.status === 'FAILED' ? <XCircle className="w-3.5 h-3.5" /> : <CircleAlert className="w-3.5 h-3.5" />}
                {last.status === 'OK' ? 'Completed successfully' : last.status === 'FAILED' ? 'Failed' : `${last.errors.length} lot(s) failed`} · {formatRelative(last.startedAt)}
              </span>
            ) : 'No pull yet'}>
            <p className="text-xl font-bold text-slate-900">{last ? formatDateTime(last.startedAt) : '—'}</p>
          </Tile>
          {[
            [Download, 'bg-blue-100 text-blue-600', 'Total Lots Read', 'fetched'],
            [FileText, 'bg-sky-100 text-sky-600', 'New Lots', 'createdLots'],
            [ClipboardCheck, 'bg-violet-100 text-violet-600', 'IMIRs Opened', 'openedImirs'],
          ].map(([Icon, tone, label, k]) => (
            <Tile key={k} icon={Icon} tone={tone} label={label} note={`in last sync · ${s?.last24h?.[k === 'fetched' ? 'fetched' : k === 'createdLots' ? 'created' : 'opened'] ?? 0} in 24 h`}>
              <p className="flex items-center gap-2 text-2xl font-bold text-slate-900 tabular">{last?.[k] ?? 0}<Trend value={s?.trend?.[k]} /></p>
            </Tile>
          ))}
          <Tile icon={StateIcon} tone={stateTile} label="Current Status"
            note={<span className="inline-flex items-center gap-1"><Wifi className="w-3.5 h-3.5" />Pulls every {s?.intervalMin ?? '…'} minutes{s?.running ? ' · pulling now' : ''}</span>}>
            <span className={`inline-block rounded-md px-2 py-0.5 text-sm font-semibold ${stateTone}`}>{stateLabel}{mock ? ' (Mock)' : ''}</span>
          </Tile>
        </div>

        <p className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-slate-700">
          <Info className="w-5 h-5 shrink-0 text-blue-600" />
          The worker pulls inward lots automatically every {s?.intervalMin ?? '…'} minutes. A lot that fails (e.g. unknown plant) is retried on the next pull once the cause is fixed.
          {s?.last24h?.withProblems > 0 && <b className="text-amber-800">{s.last24h.withProblems} pull(s) with problems in the last 24 hours.</b>}
        </p>

        <DataTable
          tableId="sap-runs"
          columns={columns}
          rows={rows}
          loading={isFetching && !data}
          error={error}
          leading={(
            <form className="flex flex-wrap items-end gap-3 flex-1 min-w-0" onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); setPage(1); }}>
              <label className="flex flex-col gap-1 w-40"><span className="text-[11px] font-medium text-slate-500">From</span>
                <input type="date" className={inputCls} value={range.from} max={range.to} onChange={(e) => { if (e.target.value) { setRange((r) => ({ ...r, from: e.target.value })); setPage(1); } }} /></label>
              <label className="flex flex-col gap-1 w-40"><span className="text-[11px] font-medium text-slate-500">To</span>
                <input type="date" className={inputCls} value={range.to} min={range.from} onChange={(e) => { if (e.target.value) { setRange((r) => ({ ...r, to: e.target.value })); setPage(1); } }} /></label>
              <label className="flex flex-col gap-1 w-40"><span className="text-[11px] font-medium text-slate-500">Status</span>
                <select className={`${inputCls} cursor-pointer`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                  <option value="">All status</option>{Object.entries(RUN).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label className="flex flex-col gap-1 w-48"><span className="text-[11px] font-medium text-slate-500">Started by</span>
                <select className={`${inputCls} cursor-pointer`} value={by} onChange={(e) => { setBy(e.target.value); setPage(1); }}>
                  <option value="">All users</option><option value="scheduler">Scheduler</option>
                  {(starters ?? []).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                </select></label>
              <label className="flex flex-col gap-1 flex-1 min-w-56"><span className="text-[11px] font-medium text-slate-500">&nbsp;</span>
                <span className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by plant, lot no, IMIR, problem…" aria-label="Search pulls" className={`${inputCls} pl-9`} /></span></label>
              <div className="flex gap-2">
                <button type="button" onClick={() => refetch()} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-blue-300 bg-white text-sm font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer"><RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />Refresh</button>
                <a href={exportUrl} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="w-4 h-4" />Export</a>
              </div>
            </form>
          )}
          onPreview={(r) => setDetail(r.id)}
          activeKey={detail}
          rowMenu={rowMenu}
          onRowClick={(r) => setDetail(r.id)}
          pagination={{ meta: data?.meta, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }}
          empty={q || status || by ? 'No pulls match these filters.' : 'No pulls in this period.'}
        />
      </div>

      {detail && <RunDetail id={detail} onClose={() => setDetail(null)} />}
      {dialog === 'simulate' && <SimulateLot onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SyncSettings s={s} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** ⋮ menu of page actions; items with `href` are links (downloads). */
function Kebab({ items }) {
  const cls = 'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left text-slate-700 hover:bg-slate-50 cursor-pointer';
  return (
    <PopMenu width="w-52" button={({ open, toggle }) => (
      <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer"><MoreVertical className="w-4 h-4" /></button>
    )}>
      {items.map((it) => (it.href
        ? <a key={it.label} role="menuitem" href={it.href} className={cls} data-close><it.icon className="w-4 h-4" />{it.label}</a>
        : <button key={it.label} type="button" role="menuitem" className={cls} data-close onClick={it.onClick}><it.icon className="w-4 h-4" />{it.label}</button>))}
    </PopMenu>
  );
}

/** One pull: figures, problems, and the lots it brought in with their IMIR. */
function RunDetail({ id, onClose }) {
  const { data: r, isLoading } = useGetSapRunQuery(id);
  if (isLoading || !r) return <Drawer title="Loading…" onClose={onClose}><div className="skeleton h-40" /></Drawer>;
  const [label, tone] = RUN[r.status];
  return (
    <Drawer title={`Pull #${r.id}`} badge={<span className={`rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${tone}`}>{label}</span>}
      subtitle={`${formatDateTime(r.startedAt)} · ${r.triggeredByName ?? 'Scheduler'}`} onClose={onClose}>
      <DrawerCard icon={DatabaseZap} title="Pull" rows={[
        ['Started', formatDateTime(r.startedAt)], ['Finished', r.finishedAt ? formatDateTime(r.finishedAt) : 'Still running'], ['Duration', duration(r.durationSec)],
        ['Adapter', r.source], ['Started by', r.triggeredByName ?? 'Scheduler'], ['Lots read', r.fetched], ['New lots', r.createdLots], ['IMIRs opened', r.openedImirs],
      ]} />
      {r.errors?.length > 0 && (
        <DrawerCard icon={AlertTriangle} title={`Problems (${r.errors.length})`}>
          <ul className="px-4 pb-3 space-y-1.5 text-sm">
            {r.errors.map((e, i) => <li key={i} className="rounded-md bg-rose-50 px-2.5 py-1.5 text-rose-800">{e.sapLotNo && <b className="font-mono">Lot {e.sapLotNo}: </b>}{e.message}</li>)}
          </ul>
          <p className="px-4 pb-3 text-xs text-slate-500">Failed lots are retried on the next pull once the cause is fixed.</p>
        </DrawerCard>
      )}
      <DrawerCard icon={PackageOpen} title={`Lots received (${r.lots.length})`}>
        {r.lots.length ? (
          <ul className="px-4 pb-3 divide-y divide-slate-100">
            {r.lots.map((l) => (
              <li key={l.sapLotNo} className="py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-800">{l.sapLotNo}</span>
                  {l.imirStatus && <ImirStatus status={l.imirStatus} />}
                  {l.imirId && <Link to={`/imirs/${l.imirId}`} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">{l.imirNo ?? 'Open'}<ExternalLink className="w-3 h-3" /></Link>}
                </div>
                <p className="text-xs text-slate-600">{l.itemCode} · {l.itemDescription}</p>
                <p className="text-xs text-slate-500">{l.vendorName ?? l.vendorCode} · {l.plantName ?? l.plantSapCode} · GRN {l.grnNo} ({formatDate(l.grnDate)}) · {formatQty(l.inwardQty, l.uom)}</p>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 pb-3 text-sm text-slate-500">No new lots in this pull{r.fetched ? ' (lots read were already known)' : ''}.</p>}
      </DrawerCard>
    </Drawer>
  );
}

/** How the sync is set up. The values come from the server's settings (.env), so they are shown, not edited here. */
function SyncSettings({ s, onClose }) {
  const rows = [
    ['Adapter', s?.mode === 'mock' ? 'Mock (test data; the SAP QA32 API is not connected yet)' : 'SAP QA32'],
    ['Automatic pull', `Every ${s?.intervalMin ?? '—'} minutes, by the background worker`],
    ['Current status', STATE[s?.state ?? 'NEVER'][0]],
    ['Failed lots', 'Retried on the next pull; the position in SAP stays before the first failed lot'],
    ['One pull at a time', 'A manual pull while another is running is refused'],
    ['Last 24 hours', s?.last24h ? `${s.last24h.pulls} pulls · ${s.last24h.fetched} lots read · ${s.last24h.created} new · ${s.last24h.opened} IMIRs opened` : '—'],
  ];
  return (
    <Modal title="Sync settings" subtitle="How inward lots come in from SAP" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <dl className="space-y-2.5 text-sm">
        {rows.map(([k, v]) => <div key={k} className="grid grid-cols-[9rem_1fr] gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></div>)}
      </dl>
      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">The interval (SAP_SYNC_INTERVAL_MIN) and adapter (SAP_MODE) are set in the server settings; changing them needs a restart of the worker.</p>
    </Modal>
  );
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function SimulateLot({ onClose }) {
  const { data: lookups } = useGetLookupsQuery();
  const form = useZodForm(sapMockLotSchema, {
    plantSapCode: '1115', itemCode: '123456', itemDescription: 'Compressor mounting bracket', itemCategory: 'Sheet Metal', uom: 'NOS',
    vendorCode: '105101', vendorName: 'MYND SOLUTIONS PRIVATE LIMITED', grnNo: `GRN${Date.now().toString().slice(-6)}`, grnDate: today(), invoiceNo: `INV${Date.now().toString().slice(-5)}`, inwardQty: 500,
  });
  const [add, { isLoading, error }] = useAddMockLotMutation();
  const [run] = useRunSapSyncMutation();
  const save = async () => {
    const data = form.validate({ inwardQty: Number(form.values.inwardQty) });
    if (!data) return;
    try {
      const r = await add(data).unwrap();
      await run().unwrap();
      toast.success(`SAP lot ${r.sapLotNo} received`);
      onClose();
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };
  const f = (name, label, props = {}) => <TextInput label={label} value={form.values[name] ?? ''} onChange={(e) => form.set(name, e.target.value)} error={form.error(name)} {...props} />;
  return (
    <Modal title="Simulate an inward lot" subtitle="Test data as SAP QA32 would send it; only while SAP is not connected" onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Receive lot" />}>
      <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Plant" required value={form.values.plantSapCode} onChange={(v) => form.set('plantSapCode', v)} error={form.error('plantSapCode')}
          options={(lookups?.plants ?? []).map((p) => ({ value: p.sapCode, label: `${p.name} (${p.sapCode})` }))} />
        {f('grnNo', 'GRN no.')}
        {f('grnDate', 'GRN date', { type: 'date' })}
        {f('invoiceNo', 'Invoice no.')}
        {f('itemCode', 'Item code')}
        {f('itemDescription', 'Item description')}
        {f('itemCategory', 'Item category')}
        {f('uom', 'UOM')}
        {f('vendorCode', 'Vendor code')}
        {f('vendorName', 'Vendor name')}
        {f('inwardQty', 'Inward quantity', { inputMode: 'decimal' })}
      </div>
    </Modal>
  );
}
