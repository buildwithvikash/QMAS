import { Download, FileUp, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { downloadImportTemplate, useCheckImportMutation, useRunImportMutation } from '../../api/formatsApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError } from '../../components/ui/fields.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';

const ITEM_STATUS = { READY: ['Ready', 'success'], SKIP: ['Skipped', 'neutral'], ERROR: ['Needs fixing', 'danger'], IMPORTED: ['Imported', 'primary'] };

/**
 * Bulk import of existing formats. Step 1 checks the file and saves nothing; step 2 imports every
 * ready item as approved version 1.
 */
export default function FormatImportPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('ERROR');
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
  const rows = result?.items.filter((i) => i.status === tab) ?? [];
  const columns = [
    { key: 'itemCode', header: 'Item', render: (i) => <div><span className="font-mono text-xs font-semibold">{i.itemCode ?? '—'}</span>{i.description && <div className="text-xs text-slate-500">{i.description}</div>}</div> },
    { key: 'rows', header: 'Rows', render: (i) => <span className="tabular text-xs">{i.firstRow}–{i.lastRow}</span> },
    { key: 'checkpoints', header: 'Checkpoints', align: 'right', render: (i) => i.checkpoints.length },
    { key: 'status', header: 'Status', render: (i) => <Badge variant={ITEM_STATUS[i.status][1]}>{ITEM_STATUS[i.status][0]}</Badge> },
    {
      key: 'messages',
      header: 'Notes',
      render: (i) => (
        <ul className="text-xs space-y-0.5">
          {i.messages.map((m, k) => (
            <li key={k} className={m.level === 'error' ? 'text-rose-600' : 'text-slate-500'}>{m.row ? `Row ${m.row}: ` : ''}{m.message}</li>
          ))}
        </ul>
      ),
    },
  ];

  return (
    <div>
      <PageHeader icon={FileUp} title="Import Formats" subtitle="Load existing formats from Excel as approved version 1">
        <Button size="sm" variant="secondary" icon={Download} onClick={() => downloadImportTemplate().catch((e) => toast.error(e.message))}>Download template</Button>
      </PageHeader>
      <div className="p-5 space-y-5">
        <section className="card p-5">
          <ol className="text-sm text-slate-600 list-decimal pl-5 space-y-1 mb-4">
            <li>Fill the template: one row per checkpoint, with the item code on every row (the "For Data" sheet layout works too).</li>
            <li>Check the file. Nothing is saved; every problem is listed with its row number.</li>
            <li>Import. Items that already have an approved format are skipped; change those through a draft.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
            <Button variant="secondary" icon={Upload} onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Choose .xlsx file'}</Button>
            {file && <span className="text-sm text-slate-700">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>}
            <Button disabled={!file} loading={checkState.isLoading} onClick={doCheck}>Check file</Button>
            {s && !imported && <Button variant="success" disabled={!s.ready} loading={runState.isLoading} onClick={() => setConfirming(true)}>Import {s.ready} format{s.ready === 1 ? '' : 's'}</Button>}
          </div>
          <div className="mt-3"><FormError message={error ? apiError(error).message : ''} /></div>
        </section>

        {s && (
          <>
            <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[['Rows', s.rows], ['Items', s.items], ['Ready', s.ready], ['Skipped', s.skipped], ['Need fixing', s.errors]].map(([label, n]) => (
                <div key={label} className="card p-3">
                  <dt className="text-[11px] font-medium text-slate-500 text-slate-400">{label}</dt>
                  <dd className="text-2xl font-bold text-slate-800 tabular">{n}</dd>
                </div>
              ))}
            </dl>
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                ...(imported ? [{ key: 'IMPORTED', label: `Imported (${s.imported})` }] : [{ key: 'READY', label: `Ready (${s.ready})` }]),
                { key: 'ERROR', label: `Need fixing (${s.errors})` },
                { key: 'SKIP', label: `Skipped (${s.skipped})` },
              ]}
            />
            <DataTable rowKey="firstRow" columns={columns} rows={rows} empty="Nothing in this group." />
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
