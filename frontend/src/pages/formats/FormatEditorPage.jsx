import { formatDraftSchema, parseSpec, SECTION_LABELS, SECTIONS } from '@qmas/shared';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, PencilLine, Plus, Save, Send, Trash2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useFormatActionMutation, useGetFormatVersionQuery, useSaveDraftMutation } from '../../api/formatsApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { fieldLabel, sectionColumns } from './formatHelpers.js';

const NUMERIC = new Set(['nominal', 'lsl', 'usl', 'frequencyMonths']);
const WIDTH = { checkpoint: 'min-w-40', specification: 'min-w-56', nominal: 'w-24', lsl: 'w-24', usl: 'w-24', uom: 'w-20', instrument: 'min-w-36', frequencyMonths: 'w-28' };
let tempKey = 0;
const toRow = (c) => ({ key: c.uid ?? `new-${(tempKey += 1)}`, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])) });
const blankRow = (section) => toRow({ section, checkpoint: section === 'VISUAL' ? 'Aesthetic' : section === 'DIMENSIONAL' ? 'Dimensions' : '', instrument: section === 'VISUAL' ? 'Visual' : '' });
const toNumber = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/** Converts editor rows to the API payload, in section order (the order errors refer to). */
function toPayload(rows) {
  const ordered = SECTIONS.flatMap((s) => rows.filter((r) => r.section === s));
  return {
    ordered,
    checkpoints: ordered.map((r) => ({
      ...(r.uid ? { uid: r.uid } : {}),
      section: r.section,
      checkpoint: r.checkpoint,
      specification: r.specification,
      nominal: r.section === 'DIMENSIONAL' ? toNumber(r.nominal) : null,
      lsl: r.section === 'DIMENSIONAL' ? toNumber(r.lsl) : null,
      usl: r.section === 'DIMENSIONAL' ? toNumber(r.usl) : null,
      uom: r.uom,
      instrument: r.instrument,
      frequencyMonths: r.section === 'RELIABILITY' ? toNumber(r.frequencyMonths) : null,
    })),
  };
}

export default function FormatEditorPage() {
  const { id } = useParams();
  const { data: v, isLoading, error } = useGetFormatVersionQuery(id, { refetchOnMountOrArgChange: true });
  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  if (!v.allowedActions.includes('edit')) return <Navigate to={`/formats/versions/${id}`} replace />;
  return <Editor key={v.id} v={v} />;
}

function Editor({ v }) {
  const navigate = useNavigate();
  const { data: lookups } = useGetLookupsQuery();
  const [header, setHeader] = useState({ formatNo: v.formatNo ?? '', commonFormatNo: v.commonFormatNo ?? '', refStandard: v.refStandard ?? '', remarks: v.remarks ?? '' });
  const [rows, setRows] = useState(() => v.checkpoints.map(toRow));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [save, saveState] = useSaveDraftMutation();
  const [act, actState] = useFormatActionMutation();
  const rowVersion = useRef(v.rowVersion);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (fn) => { setRows(fn); setDirty(true); };
  const setCell = (key, field, value) => change((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const errorOf = useMemo(() => {
    const { ordered } = toPayload(rows);
    return (key, field) => errors[`checkpoints.${ordered.findIndex((r) => r.key === key)}.${field}`];
  }, [errors, rows]);

  /** When a dimensional spec like "57 ± 0.3" is typed and limits are empty, fill them. */
  const readLimits = (row, { force = false } = {}) => {
    const parsed = parseSpec(row.specification);
    if (!parsed || (!force && (row.lsl !== '' || row.usl !== ''))) return false;
    change((rs) => rs.map((r) => (r.key === row.key ? { ...r, nominal: parsed.nominal === null ? r.nominal : String(parsed.nominal), lsl: parsed.lsl === null ? '' : String(parsed.lsl), usl: parsed.usl === null ? '' : String(parsed.usl) } : r)));
    return true;
  };

  const move = (key, dir) =>
    change((rs) => {
      const row = rs.find((r) => r.key === key);
      const same = rs.filter((r) => r.section === row.section);
      const i = same.indexOf(row);
      const j = i + dir;
      if (j < 0 || j >= same.length) return rs;
      [same[i], same[j]] = [same[j], same[i]];
      return SECTIONS.flatMap((s) => (s === row.section ? same : rs.filter((r) => r.section === s)));
    });

  const doSave = useCallback(async () => {
    setFormError('');
    const body = { ...header, checkpoints: toPayload(rows).checkpoints, rowVersion: rowVersion.current };
    const parsed = formatDraftSchema.safeParse(body);
    if (!parsed.success) {
      const next = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message;
      setErrors(next);
      setFormError(`${parsed.error.issues.length} field${parsed.error.issues.length > 1 ? 's need' : ' needs'} attention (marked in red).`);
      return null;
    }
    try {
      const saved = await save({ id: v.id, ...parsed.data }).unwrap();
      rowVersion.current = saved.rowVersion;
      setErrors({});
      setDirty(false);
      // Keep new rows' server uids so later saves update the same checkpoints.
      setRows(saved.checkpoints.map(toRow));
      return saved;
    } catch (err) {
      const e = apiError(err);
      setErrors(e.fieldErrors);
      setFormError(e.message);
      return null;
    }
  }, [header, rows, save, v.id]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doSave().then((s) => s && toast.success('Draft saved'));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [doSave]);

  const saveAndSubmit = async () => {
    const saved = await doSave();
    if (!saved) return;
    try {
      await act({ id: v.id, action: 'submit', rowVersion: saved.rowVersion }).unwrap();
      toast.success('Submitted for approval');
      navigate(`/formats/versions/${v.id}`);
    } catch (err) {
      setFormError(apiError(err).message);
    }
  };

  const instruments = [...new Set([...(lookups?.instruments ?? []).map((i) => i.name), ...rows.map((r) => r.instrument).filter(Boolean)])];
  const units = [...new Set([...(lookups?.uoms ?? []).map((u) => u.code), 'mm', '°', 'kg', ...rows.map((r) => r.uom).filter(Boolean)])];

  return (
    <div>
      <PageHeader icon={PencilLine} title={`Edit format · ${v.itemCode}`} subtitle={`${v.itemDescription} · ${v.baseVersionNo ? `changing v${v.baseVersionNo}` : 'first format'}${dirty ? ' · unsaved changes' : ''}`}>
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => (!dirty || window.confirm('Leave without saving your changes?')) && navigate(`/formats/versions/${v.id}`)}>Back</Button>
        <Button size="sm" variant="secondary" icon={Save} loading={saveState.isLoading} onClick={() => doSave().then((s) => s && toast.success('Draft saved'))}>Save draft</Button>
        <Button size="sm" icon={Send} loading={actState.isLoading} onClick={saveAndSubmit}>Save &amp; submit</Button>
      </PageHeader>

      <div className="p-5 space-y-5">
        <FormError message={formError} />
        <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput label="Format no." value={header.formatNo} onChange={(e) => { setHeader({ ...header, formatNo: e.target.value }); setDirty(true); }} error={errors.formatNo} />
          <TextInput label="Common format no." hint="Same for all plants" value={header.commonFormatNo} onChange={(e) => { setHeader({ ...header, commonFormatNo: e.target.value }); setDirty(true); }} error={errors.commonFormatNo} />
          <TextInput label="Reference standard" value={header.refStandard} onChange={(e) => { setHeader({ ...header, refStandard: e.target.value }); setDirty(true); }} error={errors.refStandard} />
          <TextInput label="Remarks for the approver" value={header.remarks} onChange={(e) => { setHeader({ ...header, remarks: e.target.value }); setDirty(true); }} error={errors.remarks} />
        </section>

        {SECTIONS.map((section) => {
          const cols = sectionColumns(section);
          const sectionRows = rows.filter((r) => r.section === section);
          return (
            <section key={section} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <h2 className="text-sm font-bold text-slate-700">{SECTION_LABELS[section]} test <span className="font-normal text-slate-400">· {sectionRows.length}</span></h2>
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => change((rs) => [...rs, blankRow(section)])}>Add</Button>
              </div>
              {sectionRows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                        <th className="px-2 py-2 w-8 text-left">#</th>
                        {cols.map((c) => <th key={c} className={`px-2 py-2 ${NUMERIC.has(c) ? 'text-right' : 'text-left'}`}>{c === 'frequencyMonths' ? 'Every (months)' : fieldLabel(c)}</th>)}
                        <th className="w-32" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sectionRows.map((r, i) => (
                        <tr key={r.key} className="align-top">
                          <td className="px-2 py-2 text-slate-400 tabular">{i + 1}</td>
                          {cols.map((f) => {
                            const err = errorOf(r.key, f);
                            return (
                              <td key={f} className={`px-1.5 py-1.5 ${WIDTH[f]}`}>
                                <input
                                  aria-label={`${fieldLabel(f)} row ${i + 1}`}
                                  aria-invalid={!!err}
                                  title={err}
                                  list={f === 'instrument' ? 'instrument-options' : f === 'uom' ? 'uom-options' : undefined}
                                  inputMode={NUMERIC.has(f) ? 'decimal' : undefined}
                                  placeholder={f === 'frequencyMonths' ? 'every lot' : f === 'specification' && section === 'DIMENSIONAL' ? 'e.g. 57 ± 0.3' : ''}
                                  value={r[f] ?? ''}
                                  onChange={(e) => setCell(r.key, f, NUMERIC.has(f) ? e.target.value.replace(/[^\d.-]/g, '') : e.target.value)}
                                  onBlur={() => f === 'specification' && section === 'DIMENSIONAL' && readLimits(r)}
                                  className={`w-full px-2 py-1.5 rounded-md border text-sm ${NUMERIC.has(f) ? 'text-right tabular' : ''} ${err ? 'border-rose-400 bg-rose-50' : 'border-slate-200'} focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400`}
                                />
                                {err && <span className="block mt-0.5 text-[11px] leading-tight text-rose-600">{err}</span>}
                              </td>
                            );
                          })}
                          <td className="px-1 py-1.5 whitespace-nowrap text-right">
                            {section === 'DIMENSIONAL' && parseSpec(r.specification) && (
                              <IconBtn label="Fill limits from specification" icon={Wand2} onClick={() => readLimits(r, { force: true })} />
                            )}
                            <IconBtn label="Move up" icon={ArrowUp} onClick={() => move(r.key, -1)} disabled={i === 0} />
                            <IconBtn label="Move down" icon={ArrowDown} onClick={() => move(r.key, 1)} disabled={i === sectionRows.length - 1} />
                            <IconBtn label="Duplicate" icon={Copy} onClick={() => change((rs) => { const at = rs.indexOf(r); const copy = { ...toRow({ ...r, uid: undefined }), key: `new-${(tempKey += 1)}` }; delete copy.uid; return [...rs.slice(0, at + 1), copy, ...rs.slice(at + 1)]; })} />
                            <IconBtn label="Delete" icon={Trash2} tone="danger" onClick={() => change((rs) => rs.filter((x) => x.key !== r.key))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
        <datalist id="instrument-options">{instruments.map((i) => <option key={i} value={i} />)}</datalist>
        <datalist id="uom-options">{units.map((u) => <option key={u} value={u} />)}</datalist>
        <p className="text-xs text-slate-400">Limits are inclusive (a reading equal to LSL or USL passes). Up to 3 decimals. Reliability frequency is in months; leave it empty to test every lot. Ctrl+S saves.</p>
      </div>
    </div>
  );
}

function IconBtn({ label, icon: Icon, onClick, disabled, tone }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className={`p-1.5 rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${tone === 'danger' ? 'text-rose-400 hover:bg-rose-50' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
