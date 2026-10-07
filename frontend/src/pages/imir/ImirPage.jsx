import { MAX_SAMPLES } from '@qmas/shared';
import {
  AlertTriangle, ArrowLeft, Boxes, Building2, Calendar, CheckCircle2, ChevronDown, ChevronsDownUp, ChevronsUpDown, ClipboardCheck, CloudOff, Factory, FileText, FlaskConical, Hash, Info, Layers, ListChecks, Loader2,
  Package, Printer, Ruler, Save, Search, Send, Tablet, Tag, Trash2, UserRound, X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDeleteAttachmentMutation, useGetImirQuery, useSaveInspectionMutation, useSubmitImirMutation, useUploadAttachmentMutation } from '../../api/imirApi.js';
import Button from '../../components/ui/Button.jsx';
import ExportLinks from '../../components/ui/ExportLinks.jsx';
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
import { focusFirstMissing, sheetProgress } from './sheetNav.js';
import { currentStage, journeySteps, stageRows } from './journey.js';
import LotJourney from './LotJourney.jsx';
import ReviewPanel from './ReviewPanel.jsx';
import HistoryPanel from '../deviation/HistoryPanel.jsx';
import RoundsPanel from '../deviation/RoundsPanel.jsx';
import { LinkedRecords, StageHistory } from '../deviation/RecordSide.jsx';
import ReversalPanel from '../deviation/ReversalPanel.jsx';
import { DeviationStage, DnStatus } from '../deviation/workflowUi.jsx';

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

  const progress = sheetProgress(sheet);
  const [find, setFind] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set()); // section keys; all expanded on opening
  const goToMissing = () => {
    if (!ev?.missing?.length) return;
    setFind(''); // a search could hide the empty cell
    setCollapsed(new Set()); // so could a collapsed section
    setTimeout(() => focusFirstMissing(ev.missing), 60);
  };
  const saveDraft = async () => {
    clearTimeout(timer.current);
    await flush();
    toast.success(mode === 'tablet' ? 'Saved on this tablet' : 'Draft saved');
  };
  const opened = sheet.status !== 'AWAITING_FORMAT';
  // The report's parts, one after another; only the parts the format has (a custom format may
  // have lot details and no dimensions). The search box sits on the first table.
  const sections = [
    progress.lot.present && { key: 'lot', label: 'Lot details', ...progress.lot },
    progress.present.dim && { key: 'dim', label: 'Dimensional test', ...progress.dim },
    progress.present.visrel && { key: 'visrel', label: 'Visual & reliability tests', ...progress.visrel },
  ].filter(Boolean);
  const searchOn = sections.find((x) => x.key !== 'lot')?.key;
  const allCollapsed = sections.every((x) => collapsed.has(x.key));
  const toggleSection = (key) => setCollapsed((c) => {
    const next = new Set(c);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const steps = journeySteps({ status: sheet.status, history: sheet.history, deviation: sheet.deviation });
  const stage = currentStage(steps);
  const since = sheet.history?.length ? sheet.history.at(-1).at : sheet.createdAt;
  const linked = [
    sheet.deviation && { kind: 'deviation', label: sheet.deviation.deviationNo, sub: `Deviation, ${sheet.deviation.department ?? 'SCM / VD (not accepted yet)'}`, to: `/deviations/${sheet.deviation.id}`, badge: <DeviationStage stage={sheet.deviation.stage} outcome={sheet.deviation.outcome} /> },
    sheet.dn && { kind: 'dn', label: sheet.dn.dnNo, sub: 'Defect notification', to: `/dns/${sheet.dn.id}`, badge: <DnStatus status={sheet.dn.status} /> },
    sheet.formatVersionId && { kind: 'format', label: `${sheet.formatNo ?? 'Inspection format'} (v${sheet.formatVersionNo})`, sub: 'Inspection format used', to: `/formats/versions/${sheet.formatVersionId}` },
  ];

  return (
    <div>
      <PageHeader icon={ClipboardCheck} title={sheet.imirNo ?? 'IMIR (not opened)'} copyTitle={!!sheet.imirNo} subtitle={`Item: ${sheet.itemCode} · ${sheet.itemDescription}`}>
        <Link to={mode === 'tablet' ? '/tablet' : '/imirs'} className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />{mode === 'tablet' ? 'This tablet' : 'Incoming lots'}</Link>
        <ImirStatus status={sheet.status} />
        {mode === 'tablet' && <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700"><Tablet className="w-3.5 h-3.5" />On this tablet</span>}
        {mode !== 'tablet' && sheet.imirNo && <ExportLinks href={`/api/v1/imirs/${sheet.id}`} />}
      </PageHeader>

      <div className="p-5 space-y-4">
        {sheet.attention && <Banner tone="danger">Not accepted by the server: {sheet.attention}. Check the entries, then ask the Incharge if the lot was released or reverted.</Banner>}
        {sheet.pendingSubmit && <Banner tone="info"><CloudOff className="w-4 h-4 inline mr-1" />Submitted on this tablet; it will be sent at the next connection.</Banner>}
        {mode === 'view' && sheet.checkoutDeviceCode && <Banner tone="info">This lot is on tablet {sheet.checkoutDeviceCode} ({sheet.checkoutUserName}) since {formatDateTime(sheet.checkedOutAt)}. Record it there.</Banner>}
        {sheet.status === 'AWAITING_FORMAT' && <Banner tone="warning">{sheet.awaitingReason} It opens automatically once that is fixed.</Banner>}

        <LotJourney status={sheet.status} history={sheet.history ?? []} deviation={sheet.deviation} dn={sheet.dn} />
        {mode !== 'tablet' && <ReviewPanel imir={sheet} />}
        {mode !== 'tablet' && sheet.imirNo && <ReversalPanel entityType="IMIR" entityId={sheet.id} recordNo={sheet.imirNo} />}

        <div className="grid gap-4 items-stretch xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <GeneralInfo sheet={sheet} />
          <InspectionStatus sheet={sheet} stage={stage} since={since} progress={opened ? progress.pct : null} />
        </div>

        <div className="grid gap-4 items-stretch xl:grid-cols-2">
          <ModelDetails sheet={sheet} readOnly={readOnly} onPatch={onPatch} opened={opened} />
          <AdditionalInfo sheet={sheet} />
        </div>

        {opened && sheet.checkpoints?.length > 0 && (
          <>
            {/* Every section starts expanded; Collapse all keeps only the headers and their progress. */}
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-xs text-slate-500">{sections.length} section{sections.length === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(sections.map((x) => x.key)))} aria-expanded={!allCollapsed}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                {allCollapsed ? <><ChevronsUpDown className="h-3.5 w-3.5" />Expand all</> : <><ChevronsDownUp className="h-3.5 w-3.5" />Collapse all</>}
              </button>
            </div>
            {sections.map((sec) => (
              <section key={sec.key} className="card overflow-hidden" aria-label={sec.label}>
                <div className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${collapsed.has(sec.key) ? '' : 'border-b border-slate-200'}`}>
                  <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    <button type="button" onClick={() => toggleSection(sec.key)} aria-expanded={!collapsed.has(sec.key)} aria-label={`${collapsed.has(sec.key) ? 'Expand' : 'Collapse'} ${sec.label}`}
                      className="-ml-1 rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer">
                      <ChevronDown className={`h-4 w-4 transition-transform ${collapsed.has(sec.key) ? '-rotate-90' : ''}`} />
                    </button>
                    {sec.label}
                    {sec.total > 0 && <span className={`text-sm font-medium tabular ${sec.done === sec.total ? 'text-emerald-700' : 'text-slate-500'}`}>({sec.done}/{sec.total})</span>}
                    {sec.nok && <span className="w-2 h-2 rounded-full bg-rose-500" title="Has a NOK" />}
                  </h2>
                  {sec.key === searchOn && !collapsed.has(sec.key) && (
                    <label className="relative ml-auto w-full sm:w-72">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search check point, specification…" aria-label="Search check points"
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                      {find && <button type="button" aria-label="Clear search" onClick={() => setFind('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"><X className="h-3.5 w-3.5" /></button>}
                    </label>
                  )}
                </div>
                {!collapsed.has(sec.key) && <InspectionSheet flat sheet={sheet} tab={sec.key} readOnly={readOnly} onPatch={onPatch} photosByCell={photosByCell} filter={sec.key === 'lot' ? '' : find}
                  onAddPhoto={readOnly ? undefined : (cp) => setDialog({ type: 'photo', cp })}
                  onOpenPhotos={(cp, s) => setDialog({ type: 'photos', cp, sampleNo: s })} />}
              </section>
            ))}
            <SignOff sheet={sheet} readOnly={readOnly} onPatch={onPatch} />
          </>
        )}

        {mode !== 'tablet' && opened && (
          <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div id="imir-history" className="min-w-0 scroll-mt-24">
              <HistoryPanel title="Full history" imirId={sheet.id} history={sheet.history ?? []} current={stage} />
            </div>
            <div className="min-w-0 space-y-4">
              <LinkedRecords items={linked} />
              <StageHistory title="History" rows={stageRows({ history: sheet.history, current: stage, start: { stage: 'SAP receipt', at: sheet.createdAt, status: 'Received' } })} />
              <RoundsPanel history={sheet.history ?? []} loop="inspection" waitingFor={sheet.status === 'SUBMITTED' ? 'Waiting for the Incharge to review' : 'Being inspected again'} />
            </div>
          </div>
        )}
      </div>

      {/* The report's actions stay at hand while scrolling. */}
      {ev && opened && !readOnly && (
        <div data-tour="imir-actions" className="sticky bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur px-5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Progress</span>
            <span className="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden"><span className={`block h-full rounded-full ${progress.pct === 100 ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${progress.pct}%` }} /></span>
            <span className="text-xs font-semibold tabular text-slate-700">{progress.pct}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Result so far</span>
            <ImirResult result={ev.result} />
          </div>
          {ev.missing.length > 0 ? (
            <button type="button" onClick={goToMissing} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 cursor-pointer">
              {ev.missing.length} empty: go to next
            </button>
          ) : !sheet.model && <span className="text-xs text-amber-700">Enter the model</span>}
          <div className="ml-auto flex items-center gap-2">
            {mode === 'online' && <span className="text-xs text-slate-400">{saving ? 'Saving…' : 'All changes saved'}</span>}
            <Button variant="secondary" icon={Save} loading={saving} onClick={saveDraft}>Save draft</Button>
            <Button icon={Send} disabled={!canSubmit || saving} onClick={() => setDialog({ type: 'submit' })}>Submit report</Button>
          </div>
        </div>
      )}

      {dialog?.type === 'submit' && <SubmitDialog sheet={sheet} mode={mode} flush={flush} onClose={() => setDialog(null)} onDone={() => navigate(mode === 'tablet' ? '/tablet' : '/imirs')} />}
      {dialog?.type === 'photo' && <PhotoDialog sheet={sheet} cp={dialog.cp} mode={mode} onClose={() => setDialog(null)} onRefresh={onRefresh} />}
      {dialog?.type === 'photos' && <PhotosViewer sheet={sheet} cp={dialog.cp} sampleNo={dialog.sampleNo} pendingFiles={pendingFiles} readOnly={readOnly || mode === 'tablet'} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Banner({ tone, children }) {
  const tones = { info: 'border-blue-200 bg-blue-50 text-blue-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', danger: 'border-rose-200 bg-rose-50 text-rose-900' };
  return <div className={`flex gap-2 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><div>{children}</div></div>;
}

/** A read-only report field: small label, then the value in a box with an icon. */
const Field = ({ label, icon: Icon, children, span }) => (
  <div className={`min-w-0 ${span ? 'sm:col-span-2' : ''}`}>
    <dt className="text-[11px] font-medium text-slate-500 mb-1">{label}</dt>
    <dd className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-900">
      {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" />}
      <span className="truncate">{children ?? <span className="text-slate-400">—</span>}</span>
    </dd>
  </div>
);

const CardHead = ({ icon: Icon, tone = 'bg-blue-100 text-blue-700', title, children }) => (
  <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span>
    <h2 className="section-title">{title}</h2>
    {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
  </div>
);

/** Report header: the lot from SAP, with the format it is inspected against. */
function GeneralInfo({ sheet }) {
  return (
    <section data-tour="imir-info" className="card h-full">
      <CardHead icon={ClipboardCheck} title="General information" />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 px-4 pb-4 md:grid-cols-4">
        <Field label="Inspection date" icon={Calendar}>{formatDate(sheet.inspectionStartedAt ?? sheet.openedAt)}</Field>
        <Field label="GRN no." icon={Hash}>{sheet.grnNo}</Field>
        <Field label="GRN date" icon={Calendar}>{formatDate(sheet.grnDate)}</Field>
        <Field label="Vendor" icon={Building2}>{sheet.vendorName}</Field>
        <Field label="Item description" icon={Package}>{sheet.itemDescription}</Field>
        <Field label="Material group" icon={Layers}>{sheet.itemCategory}</Field>
        <Field label="Plant" icon={Factory}>{sheet.plantName}</Field>
        <Field label="Item code" icon={Tag}>{sheet.itemCode}</Field>
        <Field label="Inward qty" icon={Boxes}>{formatQty(sheet.inwardQty, sheet.uom)}</Field>
        <Field label="Format no." icon={FileText}>{sheet.formatVersionNo ? `${sheet.formatNo ?? '—'} (v${sheet.formatVersionNo})` : null}</Field>
        <Field label="Common format no." icon={FileText}>{sheet.commonFormatNo}</Field>
        <Field label="Ref. standard" icon={FlaskConical}>{sheet.refStandard}</Field>
      </dl>
    </section>
  );
}

/** Progress ring. */
function Ring({ pct }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 84 84" className="h-24 w-24 shrink-0" role="img" aria-label={`${pct}% complete`}>
      <circle cx="42" cy="42" r={r} fill="none" strokeWidth="9" style={{ stroke: 'var(--color-slate-100)' }} />
      <circle cx="42" cy="42" r={r} fill="none" strokeWidth="9" strokeLinecap="round" transform="rotate(-90 42 42)"
        strokeDasharray={`${(pct / 100) * c} ${c}`} className="transition-[stroke-dasharray] duration-500" style={{ stroke: '#10b981' }} />
      <text x="42" y="47" textAnchor="middle" className="fill-slate-900 text-[17px] font-bold">{pct}%</text>
    </svg>
  );
}

/** Where the lot is now: progress, stage, who holds it and since when. */
function InspectionStatus({ sheet, stage, since, progress }) {
  const rows = [
    { icon: ListChecks, label: 'Current stage', value: stage?.label ?? '—', strong: true },
    { icon: UserRound, label: stage?.closed ? 'Result' : 'Assigned to', value: stage?.closed ? (sheet.result ?? '—') : (stage?.holder ?? '—') },
    { icon: Calendar, label: 'Since', value: formatDateTime(since) },
    !stage?.closed && (sheet.result || sheet.evaluation?.result) && { icon: CheckCircle2, label: sheet.result ? 'Result' : 'Result so far', value: <ImirResult result={sheet.result ?? sheet.evaluation.result} /> },
    sheet.formatVersionId && { icon: FileText, label: 'Inspection format', value: `${sheet.formatNo ?? 'Format'} (v${sheet.formatVersionNo})`, to: `/formats/versions/${sheet.formatVersionId}` },
  ].filter(Boolean);
  return (
    <section data-tour="imir-status" className="card h-full">
      <CardHead icon={Info} title="Inspection status" />
      <div className="flex items-center gap-4 px-4 pb-4">
        {progress !== null && <Ring pct={progress} />}
        <dl className="min-w-0 flex-1 space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-2">
              <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <dt className="text-[11px] text-slate-500">{r.label}</dt>
                <dd className={`truncate text-sm ${r.strong ? 'font-semibold text-blue-700' : 'text-slate-800'}`}>
                  {r.to ? <Link to={r.to} className="text-blue-700 hover:underline">{r.value}</Link> : r.value}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** The model the lot is for (entered by the inspector, required to submit) and the drawing. */
function ModelDetails({ sheet, readOnly, onPatch, opened }) {
  const [model, setModel] = useState(sheet.model ?? '');
  useEffect(() => setModel(sheet.model ?? ''), [sheet.model]);
  const missing = opened && !readOnly && !model.trim();
  return (
    <section data-tour="imir-model" className="card">
      <CardHead icon={Package} tone="bg-sky-100 text-sky-700" title="Model details">
        {sheet.drawingNo && <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"><Ruler className="h-3.5 w-3.5 text-slate-400" />Drawing {sheet.drawingNo}{sheet.drawingRev ? ` rev ${sheet.drawingRev}` : ''}</span>}
      </CardHead>
      <div className="px-4 pb-4">
        {opened ? (
          <>
            <label htmlFor="imir-model" className="mb-1 block text-[11px] font-medium text-slate-500">Model <span className="text-rose-600">*</span></label>
            <input id="imir-model" disabled={readOnly} value={model} placeholder="Model the lot is for" onChange={(e) => setModel(e.target.value)}
              onBlur={() => (model.trim() || null) !== (sheet.model ?? null) && onPatch({ model: model.trim() || null })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className={`w-full sm:w-72 min-h-9 rounded-lg border px-2.5 py-1.5 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-900 ${
                missing ? 'border-rose-300 bg-rose-50/60' : model.trim() ? 'border-emerald-300 bg-emerald-50/50 text-blue-800' : 'border-slate-300 bg-white'
              }`} />
            {missing && <p className="mt-1 text-[11px] text-rose-600">Needed before you can submit the report.</p>}
          </>
        ) : <p className="text-sm text-slate-500">Entered when the lot is inspected.</p>}
      </div>
    </section>
  );
}

/** The rest of the lot: SAP inspection lot, vendor code, invoice, sampling. */
function AdditionalInfo({ sheet }) {
  return (
    <section className="card">
      <CardHead icon={FileText} tone="bg-slate-100 text-slate-600" title="Additional information" />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 px-4 pb-4 md:grid-cols-4">
        <Field label="SAP inspection lot">{sheet.sapLotNo}</Field>
        <Field label="Start of inspection (SAP)">{sheet.sapInspectionStart ? formatDate(sheet.sapInspectionStart) : null}</Field>
        <Field label="Vendor code">{sheet.vendorCode}</Field>
        <Field label="Invoice no.">{sheet.invoiceNo}</Field>
        <Field label="Sample">{sheet.sampleSize ? `${sheet.sampleSize} of ${sheet.lotSize}${sheet.samplingBasis === 'FULL_LOT' ? ' (whole lot)' : ''}` : null}</Field>
        <Field label="Reject at">{sheet.sampleSize ? `${sheet.rejectNo} NOK sample${sheet.rejectNo === 1 ? '' : 's'}` : null}</Field>
      </dl>
    </section>
  );
}

const lastOf = (history, actions) => [...(history ?? [])].reverse().find((h) => actions.includes(h.action) && !h.deviationId);

/** One sign-off box: role, who signed and when, and what they decided. */
function Signature({ role, step, pending, done: doneLabel }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${step ? 'border-emerald-200 bg-emerald-50/50' : 'border-dashed border-slate-300 bg-slate-50/60'}`}>
      <div className="text-xs font-medium text-slate-600">{role}</div>
      {step ? (
        <div className="mt-1 flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-slate-900">{step.actorName ?? 'System'}</div>
            <div className="text-xs text-slate-600">{doneLabel(step)}, {formatDateTime(step.at)}</div>
            {step.remark && (
              <p className="mt-1 text-xs text-slate-700 whitespace-pre-line">
                <span className="font-medium text-slate-500">{['APPROVE', 'HEAD_APPROVE'].includes(step.action) ? 'Final approval remark: ' : 'Remark: '}</span>{step.remark}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-1 text-sm text-slate-500">{pending}</div>
      )}
    </div>
  );
}

const DECIDED = { APPROVE: 'Approved', REJECT: 'Rejected', REVERT: 'Sent back', ESCALATE: 'Escalated to IQC Head', HEAD_APPROVE: 'Approved', HOLD: 'Held for deviation' };
const OUTCOME = {
  CLOSED_ACCEPTED: ['Accepted', 'bg-emerald-600 text-white'],
  CLOSED_UNDER_DEVIATION: ['Accepted under deviation', 'bg-amber-500 text-white'],
  CLOSED_REJECTED: ['Rejected', 'bg-rose-600 text-white'],
  AUTO_CLOSED: ['Auto-closed', 'bg-slate-500 text-white'],
};

/** Final remarks, who checked / reviewed / decided (from the workflow), and the decision. */
function SignOff({ sheet, readOnly, onPatch }) {
  const [remark, setRemark] = useState(sheet.inspectorRemark ?? '');
  useEffect(() => setRemark(sheet.inspectorRemark ?? ''), [sheet.inspectorRemark]);
  const submitted = lastOf(sheet.history, ['SUBMIT']);
  const reviewed = lastOf(sheet.history, ['APPROVE', 'REJECT', 'REVERT', 'ESCALATE']);
  const decided = lastOf(sheet.history, ['HEAD_APPROVE', 'HOLD']);
  const outcome = OUTCOME[sheet.status];
  return (
    <section className="card p-4 space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Sign-off &amp; decision</h2>
      <div>
        <label htmlFor="imir-final-remarks" className="block text-sm font-semibold text-slate-900 mb-1.5">Final remarks</label>
        <textarea id="imir-final-remarks" disabled={readOnly} rows={3} value={remark} placeholder={readOnly ? '' : 'Anything the reviewer should know about this lot'}
          onChange={(e) => setRemark(e.target.value)} onBlur={() => (remark || null) !== (sheet.inspectorRemark ?? null) && onPatch({ inspectorRemark: remark || null })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 disabled:bg-slate-50" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Signature role="Checked by (Inspector)" step={submitted} pending="Signs when the report is submitted" done={() => 'Submitted'} />
        <Signature role="Reviewed by (IQC Incharge)" step={reviewed} pending="Waiting for the Incharge review" done={(s) => DECIDED[s.action]} />
        <Signature role="Decided by (IQC Head)" step={decided} pending={reviewed?.action === 'ESCALATE' ? 'Waiting for the IQC Head' : 'Only needed if escalated'} done={(s) => DECIDED[s.action]} />
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
        <span className="text-sm font-semibold text-slate-900">Final decision</span>
        {outcome
          ? <span className={`rounded-md px-3 py-1 text-sm font-semibold ${outcome[1]}`}>{outcome[0]}</span>
          : <span className="text-sm text-slate-600">Open: <ImirStatus status={sheet.status} /></span>}
        {sheet.deviation && <Link to={`/deviations/${sheet.deviation.id}`} className="text-sm text-blue-700 hover:underline">Deviation {sheet.deviation.deviationNo}</Link>}
      </div>
      {sheet.allowedActions.some((a) => ['approve', 'revert', 'escalate', 'head_approve', 'hold', 'raise_dn'].includes(a)) && <ReviewPanel imir={sheet} />}
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
          <span className="block text-[11px] font-medium text-slate-500 mb-1">Photo or PDF</span>
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
