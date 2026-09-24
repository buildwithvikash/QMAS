import { MAX_SAMPLES } from '@qmas/shared';
import { AlertTriangle, ArrowLeft, ClipboardCheck, CloudOff, FileText, Loader2, Send, Tablet, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDeleteAttachmentMutation, useGetImirQuery, useSaveInspectionMutation, useSubmitImirMutation, useUploadAttachmentMutation } from '../../api/imirApi.js';
import Button from '../../components/ui/Button.jsx';
import { Select, TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import * as engine from '../../offline/engine.js';
import { applyPatch, evaluateSheet } from '../../offline/sheetModel.js';
import * as store from '../../offline/store.js';
import { apiError } from '../../utils/apiError.js';
import { formatDate, formatDateTime, formatQty } from '../../utils/format.js';
import { ImirResult, ImirStatus } from './imirUi.jsx';
import InspectionSheet from './InspectionSheet.jsx';

/** Combines two save patches: later cells/entries win. */
function mergePatch(a, b) {
  const cells = new Map([...(a.cells ?? []), ...(b.cells ?? [])].map((c) => [`${c.checkpointUid}:${c.sampleNo}`, c]));
  const entries = new Map();
  for (const e of [...(a.entries ?? []), ...(b.entries ?? [])]) entries.set(e.checkpointUid, { ...entries.get(e.checkpointUid), ...e });
  return { ...a, ...b, cells: [...cells.values()], entries: [...entries.values()] };
}

/**
 * IMIR page. Works in three modes:
 *   online  — changes are saved to the server as you go (batched every 0.7 s);
 *   tablet  — the lot is checked out to this tablet: changes go to the offline queue;
 *   view    — submitted, not yours to inspect, or on another tablet.
 */
export default function ImirPage() {
  const { id } = useParams();
  const { data: server, isLoading, error, refetch } = useGetImirQuery(id);
  const [bundle, setBundle] = useState(undefined); // undefined = not checked yet, null = not on this tablet
  const [pendingFiles, setPendingFiles] = useState([]);

  const loadLocal = useCallback(async () => {
    setBundle((await store.getBundle(id)) ?? null);
    setPendingFiles((await store.listFiles()).filter((f) => f.imirId === id));
  }, [id]);
  useEffect(() => {
    loadLocal();
    return engine.subscribe(loadLocal);
  }, [loadLocal]);

  if (bundle === undefined || (isLoading && !bundle)) return <Loader />;
  if (bundle) return <InspectScreen key="tablet" mode="tablet" initial={{ ...bundle, evaluation: evaluateSheet(bundle) }} pendingFiles={pendingFiles} onRefresh={loadLocal} />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  const editable = server.allowedActions.includes('inspect') && !server.checkoutDeviceId;
  return <InspectScreen key={`online-${server.id}`} mode={editable ? 'online' : 'view'} initial={server} pendingFiles={[]} onRefresh={refetch} />;
}

function InspectScreen({ mode, initial, pendingFiles, onRefresh }) {
  const [sheet, setSheet] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(null);
  const pending = useRef(null);
  const timer = useRef(null);
  const [save] = useSaveInspectionMutation();
  const navigate = useNavigate();
  const readOnly = mode === 'view' || !!sheet.pendingSubmit;

  // Keep in step with the server copy when nothing is waiting to be saved.
  useEffect(() => {
    if (!pending.current) setSheet(initial);
  }, [initial]);

  const flush = useCallback(async () => {
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    setSaving(true);
    try {
      const res = await save({ id: sheet.id, ...patch }).unwrap();
      // Keep what the user typed since; take status, version and the server's evaluation.
      setSheet((s) => ({ ...s, status: res.status, rowVersion: res.rowVersion, allowedActions: res.allowedActions, cells: pending.current ? s.cells : res.cells, evaluation: pending.current ? s.evaluation : res.evaluation }));
    } catch (err) {
      toast.error(apiError(err).message);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [save, sheet.id, onRefresh]);

  useEffect(() => () => { clearTimeout(timer.current); flush(); }, [flush]);

  const onPatch = async (patch) => {
    if (readOnly) return;
    setSheet((s) => applyPatch(s, patch));
    if (mode === 'tablet') {
      try {
        await engine.recordSave(sheet.id, patch);
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    pending.current = pending.current ? mergePatch(pending.current, patch) : patch;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };

  // Photo counts per cell: uploaded files plus (on a tablet) files waiting to upload.
  const photosByCell = {};
  for (const a of sheet.attachments ?? []) photosByCell[a.ref] = (photosByCell[a.ref] ?? 0) + 1;
  for (const f of pendingFiles) photosByCell[`${f.checkpointUid}:${f.sampleNo}`] = (photosByCell[`${f.checkpointUid}:${f.sampleNo}`] ?? 0) + 1;

  const ev = sheet.evaluation;
  const canSubmit = !readOnly && ev && ev.missing.length === 0 && !!sheet.model;

  return (
    <div className="pb-24">
      <PageHeader icon={ClipboardCheck} title={sheet.imirNo ?? 'IMIR (not opened)'} subtitle={`${sheet.itemCode} · ${sheet.itemDescription}`}>
        <Link to={mode === 'tablet' ? '/tablet' : '/imirs'} className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />{mode === 'tablet' ? 'This tablet' : 'Incoming lots'}</Link>
        <ImirStatus status={sheet.status} />
        {mode === 'tablet' && <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700"><Tablet className="w-3.5 h-3.5" />On this tablet</span>}
        {mode === 'online' && <span className="text-xs text-slate-400 w-16">{saving ? 'Saving…' : 'Saved'}</span>}
      </PageHeader>

      <div className="p-5 space-y-4">
        {sheet.attention && <Banner tone="danger">Not accepted by the server: {sheet.attention}. Check the entries, then ask the Incharge if the lot was released or reverted.</Banner>}
        {sheet.pendingSubmit && <Banner tone="info"><CloudOff className="w-4 h-4 inline mr-1" />Submitted on this tablet; it will be sent at the next connection.</Banner>}
        {mode === 'view' && sheet.checkoutDeviceCode && <Banner tone="info">This lot is on tablet {sheet.checkoutDeviceCode} ({sheet.checkoutUserName}) since {formatDateTime(sheet.checkedOutAt)}. Record it there.</Banner>}
        {sheet.status === 'AWAITING_FORMAT' && <Banner tone="warning">{sheet.awaitingReason} It opens automatically once that is fixed.</Banner>}

        <LotFacts sheet={sheet} readOnly={readOnly} onPatch={onPatch} />

        {sheet.checkpoints?.length > 0 && (
          <InspectionSheet sheet={sheet} readOnly={readOnly} onPatch={onPatch} photosByCell={photosByCell}
            onAddPhoto={readOnly ? undefined : (cp) => setDialog({ type: 'photo', cp })}
            onOpenPhotos={(cp, s) => setDialog({ type: 'photos', cp, sampleNo: s })} />
        )}
      </div>

      {ev && sheet.status !== 'AWAITING_FORMAT' && (
        <div className="fixed bottom-0 right-0 left-0 md:left-auto md:w-[calc(100%-16rem)] z-30 border-t border-slate-200 bg-white/95 backdrop-blur px-5 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-600">Result so far:</span>
          <ImirResult result={sheet.result ?? ev.result} />
          {ev.defectiveSamples.length > 0 && <span className="text-xs text-rose-600">NOK in sample {ev.defectiveSamples.join(', ')}</span>}
          {!readOnly && (ev.missing.length > 0 ? <span className="text-xs text-amber-700">{ev.missing.length} required entr{ev.missing.length > 1 ? 'ies' : 'y'} still empty</span> : !sheet.model && <span className="text-xs text-amber-700">Enter the model</span>)}
          {!readOnly && <Button className="ml-auto" size="lg" icon={Send} disabled={!canSubmit || saving} onClick={() => setDialog({ type: 'submit' })}>Submit IMIR</Button>}
        </div>
      )}

      {dialog?.type === 'submit' && <SubmitDialog sheet={sheet} mode={mode} flush={flush} onClose={() => setDialog(null)} onDone={() => navigate(mode === 'tablet' ? '/tablet' : '/imirs')} />}
      {dialog?.type === 'photo' && <PhotoDialog sheet={sheet} cp={dialog.cp} mode={mode} onClose={() => setDialog(null)} onRefresh={onRefresh} />}
      {dialog?.type === 'photos' && <PhotosViewer sheet={sheet} cp={dialog.cp} sampleNo={dialog.sampleNo} pendingFiles={pendingFiles} readOnly={readOnly || mode === 'tablet'} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Banner({ tone, children }) {
  const tones = { info: 'border-sky-200 bg-sky-50 text-sky-800', warning: 'border-amber-200 bg-amber-50 text-amber-800', danger: 'border-rose-200 bg-rose-50 text-rose-800' };
  return <div className={`flex gap-2 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><div>{children}</div></div>;
}

function LotFacts({ sheet, readOnly, onPatch }) {
  const [model, setModel] = useState(sheet.model ?? '');
  const [remark, setRemark] = useState(sheet.inspectorRemark ?? '');
  useEffect(() => setModel(sheet.model ?? ''), [sheet.model]);
  const fact = (label, value) => (
    <div><dt className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{label}</dt><dd className="text-sm text-slate-800">{value ?? '—'}</dd></div>
  );
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {fact('GRN', `${sheet.grnNo} · ${formatDate(sheet.grnDate)}`)}
        {fact('Vendor', `${sheet.vendorName} (${sheet.vendorCode})`)}
        {fact('Invoice', sheet.invoiceNo)}
        {fact('Plant', `${sheet.plantSapCode} · ${sheet.plantName}`)}
        {fact('Inward qty', formatQty(sheet.inwardQty, sheet.uom))}
        {fact('Drawing', sheet.drawingNo ? `${sheet.drawingNo}${sheet.drawingRev ? ` rev ${sheet.drawingRev}` : ''}` : null)}
        {sheet.sampleSize && fact('Sample', `${sheet.sampleSize} of ${sheet.lotSize}${sheet.samplingBasis === 'FULL_LOT' ? ' (whole lot)' : ''} · reject at ${sheet.rejectNo} NOK`)}
        {sheet.formatVersionNo && fact('Format', `v${sheet.formatVersionNo}${sheet.formatNo ? ` · ${sheet.formatNo}` : ''} · ${sheet.refStandard ?? ''}`)}
        {fact('SAP lot', sheet.sapLotNo)}
        {sheet.submittedAt && fact('Submitted', `${sheet.submittedByName ?? ''} · ${formatDateTime(sheet.submittedAt)}`)}
      </dl>
      {sheet.status !== 'AWAITING_FORMAT' && (
        <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
          <TextInput label="Model" required disabled={readOnly} value={model} onChange={(e) => setModel(e.target.value)}
            onBlur={() => (model.trim() || null) !== (sheet.model ?? null) && onPatch({ model: model.trim() || null })} hint={readOnly ? undefined : 'Model the lot is for'} />
          <TextInput label="Final remarks" disabled={readOnly} value={remark} onChange={(e) => setRemark(e.target.value)}
            onBlur={() => (remark || null) !== (sheet.inspectorRemark ?? null) && onPatch({ inspectorRemark: remark || null })} />
        </div>
      )}
    </section>
  );
}

function SubmitDialog({ sheet, mode, flush, onClose, onDone }) {
  const [submit, { isLoading }] = useSubmitImirMutation();
  const [busy, setBusy] = useState(false);
  const result = sheet.evaluation.result;
  const confirm = async () => {
    setBusy(true);
    try {
      if (mode === 'tablet') {
        await engine.recordSubmit(sheet.id);
        toast.success(navigator.onLine ? 'Submitting…' : 'Submitted on this tablet; it will be sent when online.');
      } else {
        await flush();
        await submit({ id: sheet.id, rowVersion: sheet.rowVersion }).unwrap();
        toast.success(`IMIR ${sheet.imirNo} submitted`);
      }
      onDone();
    } catch (err) {
      toast.error(err.message ?? apiError(err).message);
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      title="Submit IMIR"
      variant={result === 'NOK' ? 'danger' : 'success'}
      confirmLabel={`Submit as ${result}`}
      message={`The lot result is ${result}${sheet.evaluation.defectiveSamples.length ? ` (NOK in sample ${sheet.evaluation.defectiveSamples.join(', ')})` : ''}. After submitting, observations are locked and the IQC Incharge reviews the IMIR.`}
      onConfirm={confirm}
      onCancel={onClose}
      busy={busy || isLoading}
    />
  );
}

function PhotoDialog({ sheet, cp, mode, onClose, onRefresh }) {
  const [sampleNo, setSampleNo] = useState('1');
  const [files, setFiles] = useState([]);
  const [upload] = useUploadAttachmentMutation();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      for (const file of files) {
        if (mode === 'tablet') await engine.recordPhoto(sheet.id, { checkpointUid: cp.uid, sampleNo: Number(sampleNo), file });
        else {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('checkpointUid', cp.uid);
          fd.append('sampleNo', sampleNo);
          fd.append('capturedAt', new Date().toISOString());
          await upload({ id: sheet.id, formData: fd }).unwrap();
        }
      }
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} added`);
      onRefresh();
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`Photo · ${cp.checkpoint}`} subtitle={cp.specification} onClose={onClose} size="sm"
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={busy} saveLabel="Add" />}>
      <div className="space-y-4">
        <Select label="Sample" value={sampleNo} onChange={(v) => setSampleNo(v ?? '1')} placeholder="Choose…"
          options={Array.from({ length: MAX_SAMPLES }, (_, i) => ({ value: String(i + 1), label: `Sample ${i + 1}${i + 1 <= sheet.sampleSize ? '' : ' (optional)'}` }))} />
        <label className="block">
          <span className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Photo or PDF</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" multiple
            onChange={(e) => setFiles([...e.target.files])} className="block w-full text-sm" />
        </label>
        {files.length > 0 && <p className="text-xs text-slate-500">{files.length} file(s), {(files.reduce((n, f) => n + f.size, 0) / 1024 / 1024).toFixed(1)} MB. Max 10 MB each.</p>}
      </div>
    </Modal>
  );
}

function PhotosViewer({ sheet, cp, sampleNo, pendingFiles, readOnly, onClose }) {
  const ref = `${cp.uid}:${sampleNo}`;
  const files = (sheet.attachments ?? []).filter((a) => a.ref === ref);
  const waiting = pendingFiles.filter((f) => f.checkpointUid === cp.uid && f.sampleNo === sampleNo);
  const [remove, { isLoading }] = useDeleteAttachmentMutation();
  return (
    <Modal title={`${cp.checkpoint} · sample ${sampleNo}`} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        {files.map((f) => (
          <figure key={f.id} className="rounded-lg border border-slate-200 p-2">
            {f.mimeType === 'application/pdf' ? (
              <a href={`/api/v1/files/${f.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-700 p-4"><FileText className="w-5 h-5" />{f.fileName}</a>
            ) : (
              <a href={`/api/v1/files/${f.id}`} target="_blank" rel="noreferrer"><img src={`/api/v1/files/${f.id}`} alt={f.fileName} className="w-full h-48 object-contain bg-slate-50 rounded" /></a>
            )}
            <figcaption className="mt-1 flex items-center justify-between text-xs text-slate-500">
              {formatDateTime(f.capturedAt ?? f.uploadedAt)}
              {!readOnly && (
                <button type="button" aria-label="Remove" disabled={isLoading} onClick={() => remove({ fileId: f.id, imirId: sheet.id })} className="p-1 text-rose-500 hover:bg-rose-50 rounded cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </figcaption>
          </figure>
        ))}
        {waiting.map((f) => (
          <div key={f.localId} className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4" />{f.name} — waiting to upload
          </div>
        ))}
        {!files.length && !waiting.length && <p className="text-sm text-slate-400">No files for this sample.</p>}
      </div>
    </Modal>
  );
}
