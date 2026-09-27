import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Layers, SkipForward, Upload, UploadCloud } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { downloadImportTemplate, useCheckImportMutation, useRunImportMutation } from '../../api/formatsApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError } from '../../components/ui/fields.jsx';
import { SearchBox } from '../../components/ui/ListFilters.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCards from '../../components/ui/StatCards.jsx';
import { useClientTable } from '../../hooks/useClientTable.js';
import { apiError } from '../../utils/apiError.js';

const ITEM_STATUS = { READY: ['Ready', 'success'], SKIP: ['Skipped', 'neutral'], ERROR: ['Needs fixing', 'danger'], IMPORTED: ['Imported', 'info'] };

function Step({ n, title, done, children }) {
  return (
    <section className={`card p-4 flex gap-3 ${done ? 'border-emerald-200' : ''}`}>
      <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'}`}>{done ? <CheckCircle2 className="w-4 h-4" /> : n}</span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <div className="mt-1 text-sm text-slate-600">{children}</div>
      </div>
    </section>
  );
}

/**
 * Bulk import of existing formats. Step 1 checks the file and saves nothing; step 2 imports every
 * ready item as approved version 1.
 */
export default function FormatImportPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState(null);
  const [q, setQ] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [check, checkState] = useCheckImportMutation();
  const [run, runState] = useRunImportMutation();
  const input = useRef(null);
  const error = checkState.error ?? runState.error;

  const form = () => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  };
  const doCheck = async () => {
    const res = await check(form()).unwrap().catch(() => null);
    if (res) {
      setResult(res);
      setTab(res.summary.errors ? 'ERROR' : 'READY');
    }
  };
  const doImport = async () => {
    setConfirming(false);
    const res = await run(form()).unwrap().catch(() => null);
    if (res) {
      setResult(res);
      setTab('IMPORTED');
      toast.success(`${res.summary.imported} format${res.summary.imported === 1 ? '' : 's'} imported`);
    }
  };

  const s = result?.summary;
  const imported = result?.items.some((i) => i.status === 'IMPORTED');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (result?.items ?? []).filter((i) => (!tab || i.status === tab) && (!needle || [i.itemCode, i.description, ...i.messages.map((m) => m.message)].some((v) => v?.toLowerCase().includes(needle))));
  }, [result, tab, q]);
  const table = useClientTable(rows, { sort: 'firstRow' });
  const pick = (k) => setTab(tab === k ? null : k);

  const cards = s ? [
    { key: 'rows', label: 'Rows read', value: s.rows, icon: FileSpreadsheet, tone: 'blue', isTotal: true, active: !tab, onClick: () => setTab(null), note: `${s.checkpoints ?? 0} checkpoints` },
    { key: 'items', label: 'Items found', value: s.items, icon: Layers, tone: 'slate', isTotal: true, active: false, onClick: () => setTab(null), note: 'one format each' },
    imported
      ? { key: 'imp', label: 'Imported', value: s.imported, icon: CheckCircle2, tone: 'green', active: tab === 'IMPORTED', onClick: () => pick('IMPORTED') }
      : { key: 'ready', label: 'Ready to import', value: s.ready, icon: CheckCircle2, tone: 'green', active: tab === 'READY', onClick: () => pick('READY') },
    { key: 'err', label: 'Need fixing', value: s.errors, icon: AlertTriangle, tone: 'rose', active: tab === 'ERROR', onClick: () => pick('ERROR') },
    { key: 'skip', label: 'Skipped', value: s.skipped, icon: SkipForward, tone: 'amber', active: tab === 'SKIP', onClick: () => pick('SKIP') },
  ] : [];

  const columns = [
    {
      key: 'itemCode', header: 'Item', sortable: true, text: (i) => `${i.itemCode ?? ''} ${i.description ?? ''}`,
      render: (i) => (
        <div>
          <span className="font-mono text-xs font-semibold text-slate-800">{i.itemCode ?? '—'}</span>
          {i.description && <div className="text-xs text-slate-500 max-w-72 truncate">{i.description}</div>}
        </div>
      ),
    },
    { key: 'firstRow', header: 'Rows in file', sortable: true, text: (i) => `${i.firstRow}-${i.lastRow}`, render: (i) => <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{i.firstRow}–{i.lastRow}</span> },
    { key: 'checkpoints', header: 'Checkpoints', align: 'right', text: (i) => i.checkpoints.length, render: (i) => <span className="tabular">{i.checkpoints.length}</span> },
    { key: 'status', header: 'Status', sortable: true, text: (i) => ITEM_STATUS[i.status][0], render: (i) => <Badge variant={ITEM_STATUS[i.status][1]}>{ITEM_STATUS[i.status][0]}</Badge> },
    {
      key: 'messages', header: 'Notes', text: (i) => i.messages.map((m) => `${m.row ? `Row ${m.row}: ` : ''}${m.message}`).join('; '),
      render: (i) => (i.messages.length ? (
        <ul className="text-xs space-y-0.5 max-w-xl">
          {i.messages.map((m, k) => (
            <li key={k} className={`flex gap-1.5 ${m.level === 'error' ? 'text-rose-700' : 'text-slate-500'}`}>
              {m.row && <span className="shrink-0 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-600">R{m.row}</span>}{m.message}
            </li>
          ))}
        </ul>
      ) : <span className="text-xs text-slate-300">—</span>),
    },
  ];

  return (
    <div>
      <PageHeader icon={FileUp} title="Import Formats" subtitle="Load existing formats from Excel as approved version 1">
        <Button size="sm" variant="secondary" icon={Download} onClick={() => downloadImportTemplate().catch((e) => toast.error(e.message))}>Download template</Button>
      </PageHeader>
      <div className="p-5 space-y-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <Step n={1} title="Fill the template">
            One row per checkpoint, with the item code on every row (the "For Data" sheet layout works too).
            <button type="button" onClick={() => downloadImportTemplate().catch((e) => toast.error(e.message))} className="mt-1 block text-xs font-semibold text-blue-700 hover:underline cursor-pointer">Download the template</button>
          </Step>
          <Step n={2} title="Check the file" done={!!s}>Nothing is saved yet. Every problem is listed with its row number.</Step>
          <Step n={3} title="Import" done={imported}>Items that already have an approved format are skipped: change those through a draft. For custom layouts use the <Link to="/formats" className="font-semibold text-blue-700 hover:underline">format builder</Link>.</Step>
        </div>

        <section className="card p-4">
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setTab(null); }} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => input.current?.click()}
              className="flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-left hover:border-blue-400 hover:bg-blue-50/40 cursor-pointer">
              <UploadCloud className="w-6 h-6 text-blue-600" />
              <span>
                <span className="block text-sm font-semibold text-slate-800">{file ? file.name : 'Choose an .xlsx file'}</span>
                <span className="block text-xs text-slate-500">{file ? `${(file.size / 1024).toFixed(0)} KB · click to choose another` : 'Up to 15 MB'}</span>
              </span>
            </button>
            <Button icon={Upload} disabled={!file} loading={checkState.isLoading} onClick={doCheck}>Check file</Button>
            {s && !imported && <Button variant="success" icon={CheckCircle2} disabled={!s.ready} loading={runState.isLoading} onClick={() => setConfirming(true)}>Import {s.ready} format{s.ready === 1 ? '' : 's'}</Button>}
          </div>
          <div className="mt-3"><FormError message={error ? apiError(error).message : ''} /></div>
        </section>

        {s && (
          <>
            <StatCards cards={cards} total={s.items} />
            <DataTable
              tableId="format-import"
              rowKey="firstRow"
              columns={columns}
              rows={table.rows}
              sort={table.sort}
              onSort={table.onSort}
              leading={<SearchBox value={q} onChange={setQ} placeholder="Item or note…" />}
              selectable
              exportName="format-import-check"
              pagination={table.pagination}
              empty={q ? 'Nothing matches.' : 'Nothing in this group.'}
            />
          </>
        )}
      </div>
      {confirming && (
        <ConfirmDialog title="Import formats" variant="success" confirmLabel="Import"
          message={`Create approved version 1 for ${s.ready} item${s.ready === 1 ? '' : 's'} (${s.checkpoints} checkpoints)? Items that need fixing are left out.`}
          onConfirm={doImport} onCancel={() => setConfirming(false)} busy={runState.isLoading} />
      )}
    </div>
  );
}
