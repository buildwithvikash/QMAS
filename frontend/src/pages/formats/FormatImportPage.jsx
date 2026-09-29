import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Layers, PencilLine, SkipForward, Upload, UploadCloud } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { downloadImportTemplate, useCheckImportMutation, useCheckImportRowsMutation, useRunImportMutation, useRunImportRowsMutation } from '../../api/formatsApi.js';
import { askConfirm } from '../../app/confirm.js';
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
import ImportReview from './ImportReview.jsx';

// One key per item of the check (items without an item code are keyed by their first row).
const keyOf = (i) => i.itemCode ?? `row-${i.firstRow ?? i.rows?.[0]?.rowNo ?? '?'}`;

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
 * Bulk import of existing formats. Step 1 checks the file and saves nothing; each item can then be
 * reviewed and corrected on screen (rows edited, added or removed, then checked again); step 2
 * imports every ready item as approved version 1, as corrected.
 */
export default function FormatImportPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState(null);
  const [q, setQ] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [check, checkState] = useCheckImportMutation();
  const [run, runState] = useRunImportMutation();
  const [checkRows, checkRowsState] = useCheckImportRowsMutation();
  const [runRows, runRowsState] = useRunImportRowsMutation();
  const [reviewKey, setReviewKey] = useState(null);
  const [edited, setEdited] = useState(() => new Set()); // keys of items corrected on screen
  const input = useRef(null);
  const error = checkState.error ?? runState.error ?? checkRowsState.error ?? runRowsState.error;
  const anyEdits = edited.size > 0;
  const importing = runState.isLoading || runRowsState.isLoading;
  const reviewing = result?.items.find((i) => keyOf(i) === reviewKey) ?? null;

  const form = () => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  };
  const doCheck = async () => {
    const res = await check(form()).unwrap().catch(() => null);
    if (res) {
      setResult(res);
      setEdited(new Set());
      setTab(res.summary.errors ? 'ERROR' : 'READY');
    }
  };

  // Replaces one item's rows (or drops them) and checks every row again.
  const recheck = async (key, newRows) => {
    const rows = result.items.flatMap((i) => (keyOf(i) === key ? newRows ?? [] : i.rows));
    if (!rows.length) {
      setResult(null);
      setReviewKey(null);
      toast('Every item was left out. Choose the file again to start over.');
      return;
    }
    const res = await checkRows({ sheet: result.sheet, fileName: file?.name ?? 'edited rows', rows }).unwrap().catch((err) => {
      toast.error(apiError(err).message);
      return null;
    });
    if (!res) return;
    setResult(res);
    const nextKey = newRows?.length ? (newRows[0].itemCode ? String(newRows[0].itemCode).trim().toUpperCase() : null) : null;
    const found = nextKey && res.items.find((i) => keyOf(i) === nextKey);
    setEdited((e) => new Set([...e].filter((k) => k !== key)).add(found ? keyOf(found) : key));
    setReviewKey(found ? keyOf(found) : null);
    if (newRows === null) toast.success('Item left out of the import');
    else if (found) toast[found.status === 'ERROR' ? 'error' : 'success'](found.status === 'ERROR' ? 'Checked: some rows still need fixing' : 'Checked: ready to import');
  };
  const doImport = async () => {
    setConfirming(false);
    // Once anything was corrected on screen, the corrected rows are imported (not the file).
    const res = anyEdits
      ? await runRows({ sheet: result.sheet, fileName: file?.name ?? 'edited rows', rows: result.items.flatMap((i) => i.rows) }).unwrap().catch(() => null)
      : await run(form()).unwrap().catch(() => null);
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
  const table = useClientTable(rows, { sort: 'firstRow', value: (r, k) => (k === 'firstRow' ? r.firstRow ?? Number.MAX_SAFE_INTEGER : r[k]) });
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
          {edited.has(keyOf(i)) && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Edited</span>}
          {i.description && <div className="text-xs text-slate-500 max-w-72 truncate">{i.description}</div>}
        </div>
      ),
    },
    { key: 'firstRow', header: 'Rows in file', sortable: true, text: (i) => `${i.firstRow}-${i.lastRow}`, render: (i) => (i.firstRow ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{i.firstRow}–{i.lastRow}</span> : <span className="text-xs text-slate-400">added on screen</span>) },
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
    ...(imported ? [] : [{
      key: 'review', header: '', export: false,
      render: (i) => (
        <Button size="sm" variant={i.status === 'ERROR' ? 'primary' : 'secondary'} icon={PencilLine} onClick={(e) => { e.stopPropagation(); setReviewKey(keyOf(i)); }}>
          {i.status === 'ERROR' ? 'Fix' : 'Review'}
        </Button>
      ),
    }]),
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
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setTab(null); setEdited(new Set()); setReviewKey(null); }} />
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
            {s && !imported && <Button variant="success" icon={CheckCircle2} disabled={!s.ready || checkRowsState.isLoading} loading={importing} onClick={() => setConfirming(true)}>Import {s.ready} format{s.ready === 1 ? '' : 's'}</Button>}
            {s && !imported && <span className="text-xs text-slate-500">{anyEdits ? `${edited.size} item${edited.size === 1 ? '' : 's'} corrected on screen: the corrected data is imported.` : 'Click an item to check its rows and correct them before importing.'}</span>}
          </div>
          <div className="mt-3"><FormError message={error ? apiError(error).message : ''} /></div>
        </section>

        {s && (
          <>
            <StatCards cards={cards} total={s.items} />
            <DataTable
              tableId="format-import"
              rowKey="key"
              onRowClick={imported ? undefined : (i) => setReviewKey(keyOf(i))}
              columns={columns}
              rows={table.rows.map((i) => ({ ...i, key: keyOf(i) }))}
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
          message={`Create approved version 1 for ${s.ready} item${s.ready === 1 ? '' : 's'} (${s.checkpoints} checkpoints)? Items that need fixing are left out.${anyEdits ? ' Your corrections are included.' : ''}`}
          onConfirm={doImport} onCancel={() => setConfirming(false)} busy={importing} />
      )}
      {reviewing && (
        <ImportReview
          key={`${reviewKey}-${reviewing.rows.length}-${reviewing.messages.length}-${reviewing.status}`}
          item={reviewing}
          checking={checkRowsState.isLoading}
          onApply={(rows) => recheck(reviewKey, rows)}
          onRemove={async () => {
            if (await askConfirm({ title: 'Leave this item out?', message: `${reviewing.itemCode ?? 'This item'} is not imported. The other items are checked again.`, confirmLabel: 'Leave out' })) recheck(reviewKey, null);
          }}
          onClose={() => setReviewKey(null)}
        />
      )}
    </div>
  );
}
