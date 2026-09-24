import { capaSchema, DN_MAX_IMAGES } from '@qmas/shared';
import { ArrowLeft, CheckCircle2, CornerUpLeft, FileText, FileX2, ImagePlus, Mail, Paperclip, Plus, Printer, Save, Send, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import { useDeleteDnFileMutation, useDnActionMutation, useGetDnQuery, useMailDnToSelfMutation, useUpdateDnMutation, useUploadDnFileMutation } from '../../api/dnApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextArea, TextInput, Toggle } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatDate, formatDateTime, formatQty } from '../../utils/format.js';
import { DnStatus, HistoryTimeline } from '../deviation/workflowUi.jsx';

export default function DnPage() {
  const { id } = useParams();
  const { data: dn, isLoading, error } = useGetDnQuery(id);
  const [mail, { isLoading: mailing }] = useMailDnToSelfMutation();
  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  const editable = dn.allowedActions.includes('edit');

  const mailMe = async () => {
    try {
      const r = await mail(dn.id).unwrap();
      toast.success(`DN will be mailed to ${r.email}`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <div className="pb-10">
      <PageHeader icon={FileX2} title={dn.dnNo} subtitle={`${dn.itemCode} · ${dn.itemDescription}`}>
        <Link to="/dns" className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />Defect notifications</Link>
        <DnStatus status={dn.status} overdue={dn.capaOverdue} />
        <a href={`/api/v1/dns/${dn.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><Printer className="w-4 h-4" />PDF</a>
        <Button size="sm" variant="secondary" icon={Mail} loading={mailing} onClick={mailMe}>Mail to me</Button>
      </PageHeader>

      <div className="p-5 grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-4 min-w-0">
          <Facts dn={dn} />
          {editable ? <DnForm key={dn.rowVersion} dn={dn} /> : <DnView dn={dn} />}
          <Images dn={dn} editable={editable} />
          <CapaSection dn={dn} />
        </div>
        <aside>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-800 mb-3">History</h2>
            <HistoryTimeline history={dn.history} />
          </section>
        </aside>
      </div>
    </div>
  );
}

const fact = (label, value) => <div><dt className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{label}</dt><dd className="text-sm text-slate-800">{value ?? '—'}</dd></div>;

function Facts({ dn }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {fact('DN date', formatDateTime(dn.dnDate))}
        {fact('IMIR', <Link to={`/imirs/${dn.imirId}`} className="font-mono text-blue-700 hover:underline">{dn.imirNo}</Link>)}
        {fact('Inspection', `${formatDate(dn.inspectedAt)} · ${dn.imirResult === 'NOK' ? 'Not OK' : dn.imirResult ?? '—'}`)}
        {fact('Vendor', `${dn.vendorName} (${dn.vendorCode})`)}
        {fact('GRN', `${dn.grnNo} · ${formatDate(dn.grnDate)}`)}
        {fact('Invoice', dn.invoiceNo)}
        {fact('Plant', `${dn.plantSapCode} · ${dn.plantName}`)}
        {fact('Drawing', dn.drawingNo ? `${dn.drawingNo}${dn.drawingRev ? ` rev ${dn.drawingRev}` : ''}` : null)}
        {dn.capaApplicable && fact('CAPA due', <span className={dn.capaOverdue ? 'text-rose-600 font-semibold' : ''}>{formatDateTime(dn.capaDueAt)}</span>)}
        {fact('Raised by', dn.createdByName)}
        {dn.closedAt && fact('Closed', `${dn.closedByName} · ${formatDateTime(dn.closedAt)}`)}
      </dl>
    </section>
  );
}

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function DnForm({ dn }) {
  const [v, setV] = useState({
    model: dn.model ?? '', receivedQty: dn.receivedQty ?? '', checkedQty: dn.checkedQty ?? '', defectiveQty: dn.defectiveQty ?? '',
    capaApplicable: dn.capaApplicable, defect: dn.defect ?? '', correction: dn.correction ?? '',
  });
  const [lines, setLines] = useState(dn.lines.length ? dn.lines : [{ parameter: '', specification: '', observation: '' }]);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [save, { isLoading }] = useUpdateDnMutation();
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const setLine = (i, k, value) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: value } : l)));

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    const body = {
      id: dn.id, rowVersion: dn.rowVersion, model: v.model.trim() || null, capaApplicable: v.capaApplicable, defect: v.defect.trim() || null, correction: v.correction.trim() || null,
      receivedQty: numOrNull(v.receivedQty), checkedQty: numOrNull(v.checkedQty), defectiveQty: numOrNull(v.defectiveQty),
      lines: lines.filter((l) => l.parameter.trim()).map((l) => ({ parameter: l.parameter.trim(), specification: l.specification?.trim() || null, observation: l.observation?.trim() || null })),
    };
    try {
      await save(body).unwrap();
      toast.success('DN saved');
    } catch (err) {
      const e = apiError(err);
      setError(e.message);
      setFieldErrors(e.fieldErrors);
    }
  };

  return (
    <section className="rounded-xl border border-blue-200 bg-white p-4 space-y-4">
      <h2 className="text-sm font-bold text-slate-800">Defect notification</h2>
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-4">
        <TextInput label="Model" value={v.model} onChange={set('model')} maxLength={60} />
        <TextInput label={`Received qty (${dn.uom ?? ''})`} type="number" min="0" step="any" value={v.receivedQty} onChange={set('receivedQty')} error={fieldErrors.receivedQty} />
        <TextInput label="Checked qty" type="number" min="0" step="any" value={v.checkedQty} onChange={set('checkedQty')} error={fieldErrors.checkedQty} />
        <TextInput label="Defective qty" type="number" min="0" step="any" value={v.defectiveQty} onChange={set('defectiveQty')} error={fieldErrors.defectiveQty} />
      </div>
      <div>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Defect details</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
              <tr><th className="px-2 py-2 text-left w-8">#</th><th className="px-2 py-2 text-left">Parameter</th><th className="px-2 py-2 text-left">Specification</th><th className="px-2 py-2 text-left">Defect observed</th><th className="w-10" /></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 text-slate-400">{i + 1}</td>
                  {['parameter', 'specification', 'observation'].map((k) => (
                    <td key={k} className="px-1 py-1">
                      <input value={l[k] ?? ''} onChange={(e) => setLine(i, k, e.target.value)} aria-label={`${k} ${i + 1}`}
                        className="w-full px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </td>
                  ))}
                  <td className="px-1">
                    <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button className="mt-2" size="sm" variant="ghost" icon={Plus} onClick={() => setLines((ls) => [...ls, { parameter: '', specification: '', observation: '' }])}>Add line</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Defect" value={v.defect} onChange={set('defect')} maxLength={2000} />
        <TextArea label="Correction" value={v.correction} onChange={set('correction')} maxLength={2000} hint="Immediate action taken on this lot" />
      </div>
      <Toggle label="CAPA applicable" checked={v.capaApplicable} onChange={set('capaApplicable')} description="The vendor shares CAPA within 3 days of the DN date." />
      <div className="flex justify-end"><Button icon={Save} loading={isLoading} onClick={submit}>Save DN</Button></div>
    </section>
  );
}

function DnView({ dn }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-bold text-slate-800">Defect notification</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
        {fact('Model', dn.model)}
        {fact('Received', formatQty(dn.receivedQty ?? 0, dn.uom))}
        {fact('Checked', formatQty(dn.checkedQty ?? 0, dn.uom))}
        {fact('Defective', formatQty(dn.defectiveQty ?? 0, dn.uom))}
      </dl>
      <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500"><tr><th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">Parameter</th><th className="px-2 py-2 text-left">Specification</th><th className="px-2 py-2 text-left">Defect observed</th></tr></thead>
        <tbody>{dn.lines.map((l) => <tr key={l.lineNo} className="border-t border-slate-100"><td className="px-2 py-1.5 text-slate-400">{l.lineNo}</td><td className="px-2">{l.parameter}</td><td className="px-2">{l.specification}</td><td className="px-2">{l.observation}</td></tr>)}</tbody>
      </table>
      <dl className="grid gap-3 sm:grid-cols-2">
        {fact('Defect', <span className="whitespace-pre-line">{dn.defect}</span>)}
        {fact('Correction', <span className="whitespace-pre-line">{dn.correction}</span>)}
      </dl>
      <p className="text-xs text-slate-500">CAPA {dn.capaApplicable ? 'applicable' : 'not applicable'}.</p>
    </section>
  );
}

function useFileUpload(dn, kind) {
  const [upload, { isLoading }] = useUploadDnFileMutation();
  const input = useRef(null);
  const pick = () => input.current?.click();
  const onChange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', f);
      try {
        await upload({ id: dn.id, formData: fd }).unwrap();
      } catch (err) {
        toast.error(`${f.name}: ${apiError(err).message}`);
        return;
      }
    }
    toast.success(files.length > 1 ? `${files.length} files added` : 'File added');
  };
  const accept = kind === 'IMAGE' ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,application/pdf';
  return { pick, isLoading, inputEl: <input ref={input} type="file" accept={accept} multiple className="hidden" onChange={onChange} /> };
}

function FileTile({ f, dnId, removable }) {
  const [remove, { isLoading }] = useDeleteDnFileMutation();
  const url = `/api/v1/files/${f.id}`;
  const del = async () => {
    try {
      await remove({ fileId: f.id, dnId }).unwrap();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <figure className="rounded-lg border border-slate-200 p-2">
      {f.mimeType === 'application/pdf'
        ? <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-700 p-3"><FileText className="w-5 h-5" /><span className="truncate">{f.fileName}</span></a>
        : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={f.fileName} className="w-full h-36 object-contain bg-slate-50 rounded" /></a>}
      <figcaption className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="truncate">{f.fileName}</span>
        {removable && <button type="button" aria-label={`Remove ${f.fileName}`} disabled={isLoading} onClick={del} className="p-1 text-rose-500 hover:bg-rose-50 rounded cursor-pointer"><Trash2 className="w-4 h-4" /></button>}
      </figcaption>
    </figure>
  );
}

function Images({ dn, editable }) {
  const up = useFileUpload(dn, 'IMAGE');
  if (!editable && !dn.images.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">Images</h2>
        <span className="text-xs text-slate-400">{dn.images.length} of {DN_MAX_IMAGES}</span>
        {editable && dn.images.length < DN_MAX_IMAGES && <Button className="ml-auto" size="sm" variant="secondary" icon={ImagePlus} loading={up.isLoading} onClick={up.pick}>Add photo</Button>}
        {up.inputEl}
      </div>
      {dn.images.length > 0 ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">{dn.images.map((f) => <FileTile key={f.id} f={f} dnId={dn.id} removable={editable} />)}</div>
      ) : <p className="text-sm text-slate-400">No images yet.</p>}
    </section>
  );
}

function CapaSection({ dn }) {
  const canSubmit = dn.allowedActions.includes('submit_capa');
  const canReview = dn.allowedActions.includes('approve_capa');
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <h2 className="text-sm font-bold text-slate-800">CAPA</h2>
      {!dn.capaApplicable && <p className="text-sm text-slate-500">CAPA does not apply to this DN.</p>}
      {[...dn.capas].reverse().map((c) => <CapaCard key={c.id} c={c} files={dn.capaFiles.filter((f) => f.cycleNo === c.cycleNo)} dnId={dn.id} />)}
      {canSubmit && <CapaForm dn={dn} />}
      {canReview && <CapaReview dn={dn} />}
      {!canSubmit && !canReview && dn.status === 'OPEN' && dn.capaApplicable && !dn.capas.length && <p className="text-sm text-slate-500">Awaiting the vendor&apos;s CAPA, due {formatDateTime(dn.capaDueAt)}.</p>}
    </section>
  );
}

function CapaCard({ c, files, dnId }) {
  const review = c.reviewDecision === 'APPROVED' ? 'border-emerald-200 bg-emerald-50' : c.reviewDecision === 'RESUBMIT' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50';
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Cycle {c.cycleNo}</span>
        <span className="text-xs text-slate-500">{c.submittedByName} · {formatDateTime(c.submittedAt)}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {fact('Root cause', <span className="whitespace-pre-line">{c.rootCause}</span>)}
        {fact('Corrective action', <span className="whitespace-pre-line">{c.correctiveAction}</span>)}
        {fact('Target date', formatDate(c.targetDate))}
        {fact('Closing date', formatDate(c.closingDate))}
        {fact('Responsibility', c.responsibility)}
        {c.remark && fact('Remark', c.remark)}
      </dl>
      {files.length > 0 && <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">{files.map((f) => <FileTile key={f.id} f={f} dnId={dnId} removable={false} />)}</div>}
      <div className={`rounded-md border px-3 py-2 text-sm ${review}`}>
        {c.reviewDecision ? <><span className="font-semibold">{c.reviewDecision === 'APPROVED' ? 'Approved' : 'Resubmission asked'}</span> by {c.reviewedByName} · {formatDateTime(c.reviewedAt)}{c.reviewRemark && <div className="text-slate-700">{c.reviewRemark}</div>}</> : 'With the IQC Head for review.'}
      </div>
    </div>
  );
}

function CapaForm({ dn }) {
  const last = dn.capas.at(-1);
  const f = useZodForm(capaSchema, {
    rootCause: last?.rootCause ?? '', correctiveAction: last?.correctiveAction ?? '', targetDate: last?.targetDate ?? '', closingDate: last?.closingDate ?? '', responsibility: last?.responsibility ?? '',
  });
  const [remark, setRemark] = useState('');
  const [error, setError] = useState(null);
  const [run, { isLoading }] = useDnActionMutation();
  const up = useFileUpload(dn, 'CAPA');
  const pending = dn.capaFiles.filter((x) => x.cycleNo === dn.nextCycleNo);

  const submit = async () => {
    setError(null);
    let capa;
    if (dn.capaApplicable) {
      capa = f.validate({ closingDate: f.values.closingDate || null });
      if (!capa) return;
    }
    try {
      await run({ id: dn.id, action: 'submit_capa', rowVersion: dn.rowVersion, remark: remark.trim() || null, capa }).unwrap();
      toast.success(dn.capaApplicable ? 'CAPA sent to the IQC Head' : 'DN sent to the IQC Head for closure');
    } catch (err) {
      setError(apiError(err).message);
    }
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-3">
      <h3 className="text-sm font-bold text-slate-800">{dn.capaApplicable ? `Vendor CAPA${dn.nextCycleNo > 1 ? ` (resubmission ${dn.nextCycleNo})` : ''}` : 'Send for closure'}</h3>
      <FormError message={error} />
      {dn.capaApplicable && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextArea label="Root cause" required value={f.values.rootCause} onChange={(e) => f.set('rootCause', e.target.value)} error={f.error('rootCause')} maxLength={2000} />
            <TextArea label="Corrective action" required value={f.values.correctiveAction} onChange={(e) => f.set('correctiveAction', e.target.value)} error={f.error('correctiveAction')} maxLength={2000} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput label="Target date" required type="date" value={f.values.targetDate} onChange={(e) => f.set('targetDate', e.target.value)} error={f.error('targetDate')} />
            <TextInput label="Closing date" type="date" value={f.values.closingDate ?? ''} onChange={(e) => f.set('closingDate', e.target.value)} error={f.error('closingDate')} />
            <TextInput label="Responsibility" required value={f.values.responsibility} onChange={(e) => f.set('responsibility', e.target.value)} error={f.error('responsibility')} maxLength={200} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Vendor CAPA document</span>
              <Button size="sm" variant="ghost" icon={Paperclip} loading={up.isLoading} onClick={up.pick}>Attach</Button>
              {up.inputEl}
            </div>
            {pending.length > 0 && <div className="mt-2 grid gap-2 grid-cols-2 lg:grid-cols-4">{pending.map((x) => <FileTile key={x.id} f={x} dnId={dn.id} removable />)}</div>}
          </div>
        </>
      )}
      <TextInput label="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} />
      <div className="flex justify-end"><Button icon={Send} loading={isLoading} onClick={submit}>{dn.capaApplicable ? 'Submit CAPA to IQC Head' : 'Send for closure'}</Button></div>
    </div>
  );
}

function CapaReview({ dn }) {
  const [remark, setRemark] = useState('');
  const [error, setError] = useState(null);
  const [run, { isLoading }] = useDnActionMutation();
  const decide = async (action) => {
    setError(null);
    if (action === 'resubmit' && !remark.trim()) return setError('Give the reason for resubmission.');
    try {
      await run({ id: dn.id, action, rowVersion: dn.rowVersion, remark: remark.trim() || null }).unwrap();
      toast.success(action === 'approve_capa' ? `DN ${dn.dnNo} closed` : 'Sent back for resubmission');
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-3">
      <h3 className="text-sm font-bold text-slate-800">Your review</h3>
      <FormError message={error} />
      <TextArea label="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} hint="Required when asking for resubmission" />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" icon={CornerUpLeft} loading={isLoading} onClick={() => decide('resubmit')}>Ask resubmission</Button>
        <Button variant="success" icon={CheckCircle2} loading={isLoading} onClick={() => decide('approve_capa')}>{dn.capaApplicable ? 'Approve CAPA and close' : 'Close DN'}</Button>
      </div>
    </div>
  );
}
