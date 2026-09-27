import {
  DISPLAY_SECTIONS, formatDraftSchema, INPUT_TYPE_LABELS, INPUT_TYPES, parseSpec, SECTION_LABELS, SECTIONS, yesNoOptions,
} from '@qmas/shared';
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Copy, Eye, GripVertical, Hammer, LayoutTemplate, PencilLine, Plus, Save, Send, Settings2, Trash2, Wand2, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFormatActionMutation, useGetFormatVersionQuery, useSaveDraftMutation } from '../../api/formatsApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { groupCheckpoints, ruleText } from './formatHelpers.js';
import { SECTION_TONE, TYPE_LOOK } from './formatLook.js';
import { TypeChip } from './formatUi.jsx';

/**
 * Format builder: the inspection report laid out by the user. Sections (own headings) hold fields of
 * the section's kind: per-sample measurements and checks, per-lot tests and lot details. Fields are
 * added from the palette, arranged by drag or arrows, and set up in the properties panel; the
 * preview shows the sheet as the inspector will see it. Saving validates like the server does.
 */

const KIND_HELP = {
  RECORD: 'Recorded once per lot: batch no., certificates, weights, dates…',
  DIMENSIONAL: 'A reading per sample, checked against limits.',
  VISUAL: 'A check per sample: OK / Not OK, or one of your options.',
  RELIABILITY: 'A test per lot (or every few months) with an observation and OK / Not OK.',
};
const PALETTE = [
  { title: 'Per sample', items: [
    { kind: 'DIMENSIONAL', type: 'MEASURE', label: 'Measurement', help: 'Reading against LSL / USL' },
    { kind: 'VISUAL', type: 'OK_NOK', label: 'OK / Not OK check', help: 'Tick per sample' },
    { kind: 'VISUAL', type: 'CHOICE', label: 'Choice per sample', help: 'Options that pass or fail' },
  ] },
  { title: 'Per lot', items: [
    { kind: 'RELIABILITY', type: 'LOT_TEST', label: 'Lot test', help: 'Observation + OK / Not OK' },
    { kind: 'RECORD', type: 'TEXT', label: 'Text', help: 'Batch no., heat no., remarks' },
    { kind: 'RECORD', type: 'NUMBER', label: 'Number', help: 'Optional limits decide OK' },
    { kind: 'RECORD', type: 'DATE', label: 'Date', help: 'Manufacture, expiry…' },
    { kind: 'RECORD', type: 'YES_NO', label: 'Yes / No', help: 'e.g. Test certificate received' },
    { kind: 'RECORD', type: 'CHOICE', label: 'Choice per lot', help: 'Pick one option' },
  ] },
];

let seq = 0;
const nextKey = (p = 'k') => `${p}-${(seq += 1)}`;
const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const clean = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

function defaultsFor(kind, type) {
  const base = { key: nextKey('f'), section: kind, inputType: type, checkpoint: '', specification: '', nominal: '', lsl: '', usl: '', uom: '', instrument: '', frequencyMonths: '', options: null, isRequired: true, helpText: '' };
  if (type === 'MEASURE') return { ...base, uom: 'mm' };
  if (type === 'OK_NOK') return { ...base, checkpoint: 'Aesthetic', specification: 'Free from burr, rust and dents', instrument: 'Visual' };
  if (type === 'CHOICE' && kind === 'VISUAL') return { ...base, instrument: 'Visual', options: [{ label: 'Matches master', pass: true }, { label: 'Minor variation', pass: true }, { label: 'Not acceptable', pass: false }] };
  if (type === 'CHOICE') return { ...base, options: [{ label: 'Option 1', pass: true }, { label: 'Option 2', pass: true }] };
  if (type === 'YES_NO') return { ...base, options: yesNoOptions('YES') };
  return base;
}

const toField = (c, sectionId) => ({
  key: c.uid ?? nextKey('f'), uid: c.uid, sectionId, section: c.section, inputType: c.inputType, checkpoint: str(c.checkpoint), specification: str(c.specification),
  nominal: str(c.nominal), lsl: str(c.lsl), usl: str(c.usl), uom: str(c.uom), instrument: str(c.instrument), frequencyMonths: str(c.frequencyMonths),
  options: c.options?.length ? c.options.map((o) => ({ ...o })) : null, isRequired: c.isRequired !== false, helpText: str(c.helpText),
});

/** Sections (headings) and fields of a saved version, in sheet order. */
function fromVersion(checkpoints) {
  const sections = [];
  const fields = [];
  for (const g of groupCheckpoints(checkpoints)) {
    const id = nextKey('s');
    sections.push({ id, kind: g.section, label: g.custom ? g.label : '' });
    for (const c of g.items) fields.push(toField(c, id));
  }
  return { sections, fields };
}

/** Keeps sections in display order of their kind (a sheet always runs lot details → dimensional → visual → reliability). */
const sortSections = (list) => DISPLAY_SECTIONS.flatMap((k) => list.filter((s) => s.kind === k));
const sectionTitle = (s) => s.label || SECTION_LABELS[s.kind];

/** Editor state → API payload, in the order the sheet shows it; `ordered` maps error indexes back to fields. */
function toPayload(sections, fields) {
  const ordered = SECTIONS.flatMap((kind) => sortSections(sections).filter((s) => s.kind === kind).flatMap((s) => fields.filter((f) => f.sectionId === s.id)));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const limits = (f) => f.section === 'DIMENSIONAL' || f.inputType === 'NUMBER';
  return {
    ordered,
    checkpoints: ordered.map((f) => ({
      ...(f.uid ? { uid: f.uid } : {}),
      section: f.section,
      groupLabel: clean(byId.get(f.sectionId)?.label),
      inputType: f.inputType,
      checkpoint: f.checkpoint,
      specification: clean(f.specification),
      nominal: limits(f) ? num(f.nominal) : null,
      lsl: limits(f) ? num(f.lsl) : null,
      usl: limits(f) ? num(f.usl) : null,
      uom: clean(f.uom),
      instrument: clean(f.instrument),
      frequencyMonths: f.section === 'RELIABILITY' ? num(f.frequencyMonths) : null,
      options: f.inputType === 'CHOICE' || f.inputType === 'YES_NO' ? (f.options ?? []).map((o) => ({ label: o.label, pass: o.pass })) : null,
      isRequired: f.section === 'RECORD' ? f.isRequired : true,
      helpText: clean(f.helpText),
    })),
  };
}

const STARTERS = [
  {
    key: 'standard', title: 'Standard IQC report', help: 'Dimensional and visual tables, as on the JIR sheet.',
    build: () => {
      const d = { id: nextKey('s'), kind: 'DIMENSIONAL', label: '' };
      const v = { id: nextKey('s'), kind: 'VISUAL', label: '' };
      return { sections: [d, v], fields: [{ ...defaultsFor('DIMENSIONAL', 'MEASURE'), sectionId: d.id }, { ...defaultsFor('VISUAL', 'OK_NOK'), sectionId: v.id }] };
    },
  },
  {
    key: 'documents', title: 'With lot details', help: 'Adds batch no. and test certificate checks before the tables.',
    build: () => {
      const r = { id: nextKey('s'), kind: 'RECORD', label: 'Supplier documents' };
      const d = { id: nextKey('s'), kind: 'DIMENSIONAL', label: '' };
      const v = { id: nextKey('s'), kind: 'VISUAL', label: '' };
      return {
        sections: [r, d, v],
        fields: [
          { ...defaultsFor('RECORD', 'TEXT'), checkpoint: 'Batch / lot no.', sectionId: r.id },
          { ...defaultsFor('RECORD', 'YES_NO'), checkpoint: 'Test certificate received', sectionId: r.id },
          { ...defaultsFor('DIMENSIONAL', 'MEASURE'), sectionId: d.id },
          { ...defaultsFor('VISUAL', 'OK_NOK'), sectionId: v.id },
        ],
      };
    },
  },
];

export default function FormatBuilderPage() {
  const { id } = useParams();
  const { data: v, isLoading, error } = useGetFormatVersionQuery(id, { refetchOnMountOrArgChange: true });
  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  if (!v.allowedActions.includes('edit')) return <Navigate to={`/formats/versions/${id}`} replace />;
  return <Builder key={v.id} v={v} />;
}

function Builder({ v }) {
  const navigate = useNavigate();
  const { data: lookups } = useGetLookupsQuery();
  const [params] = useSearchParams();
  // Opened from the format page: ?focus=<uid> selects a checkpoint, ?remove=<uid> takes one out,
  // ?add=<section>&group=<heading> adds a new one to that section (the draft is then unsaved).
  const initial = useMemo(() => {
    const base = fromVersion(v.checkpoints);
    const focus = params.get('focus');
    const remove = params.get('remove');
    const add = params.get('add');
    let fields = base.fields;
    let sections = base.sections;
    let selected = focus && fields.some((f) => f.key === focus) ? { type: 'field', id: focus } : null;
    if (remove) fields = fields.filter((f) => f.key !== remove);
    if (add && SECTIONS.includes(add)) {
      const group = params.get('group') ?? '';
      let target = sections.find((x) => x.kind === add && (x.label || SECTION_LABELS[add]) === (group || SECTION_LABELS[add])) ?? sections.find((x) => x.kind === add);
      if (!target) {
        target = { id: nextKey('s'), kind: add, label: '' };
        sections = sortSections([...sections, target]);
      }
      const f = { ...defaultsFor(add, INPUT_TYPES[add][0]), sectionId: target.id };
      if (add === 'DIMENSIONAL') f.checkpoint = '';
      fields = [...fields, f];
      selected = { type: 'field', id: f.key };
    }
    return { sections, fields, selected, changed: fields.length !== base.fields.length };
  }, [v.checkpoints]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sections, setSections] = useState(initial.sections);
  const [fields, setFields] = useState(initial.fields);
  const [header, setHeader] = useState({ formatNo: v.formatNo ?? '', commonFormatNo: v.commonFormatNo ?? '', refStandard: v.refStandard ?? '', remarks: v.remarks ?? '' });
  const [selected, setSelected] = useState(initial.selected); // { type: 'field' | 'section', id }
  const [mode, setMode] = useState('build');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(initial.changed);
  const [save, saveState] = useSaveDraftMutation();
  const [act, actState] = useFormatActionMutation();
  const rowVersion = useRef(v.rowVersion);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const touch = () => setDirty(true);
  const ordered = useMemo(() => sortSections(sections), [sections]);
  const updateField = (key, patch) => { setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f))); touch(); };
  const updateSection = (sid, patch) => { setSections((ss) => ss.map((s) => (s.id === sid ? { ...s, ...patch } : s))); touch(); };

  /** Field errors from the last validation, by field key: { fieldName: message }. */
  const errorsByKey = useMemo(() => {
    const { ordered: list } = toPayload(sections, fields);
    const out = {};
    for (const [path, message] of Object.entries(errors)) {
      const m = /^checkpoints\.(\d+)\.?(\w*)/.exec(path);
      if (!m) continue;
      const f = list[Number(m[1])];
      if (f) (out[f.key] ??= {})[m[2] || '_'] = message;
    }
    return out;
  }, [errors, sections, fields]);

  const addSection = (kind, label = '') => {
    const taken = sections.filter((s) => s.kind === kind);
    const s = { id: nextKey('s'), kind, label: label || (taken.length ? `${SECTION_LABELS[kind]} ${taken.length + 1}` : '') };
    setSections((ss) => [...ss, s]);
    setSelected({ type: 'section', id: s.id });
    touch();
    return s;
  };
  /** Adds a field to the selected section when it fits, else to the last section of its kind (made if missing). */
  const addField = (kind, type) => {
    const sel = selected?.type === 'section' ? sections.find((s) => s.id === selected.id) : selected?.type === 'field' ? sections.find((s) => s.id === fields.find((f) => f.key === selected.id)?.sectionId) : null;
    const target = sel?.kind === kind ? sel : [...sections].reverse().find((s) => s.kind === kind) ?? addSection(kind);
    const f = { ...defaultsFor(kind, type), sectionId: target.id };
    setFields((fs) => {
      const after = selected?.type === 'field' ? fs.findIndex((x) => x.key === selected.id) : -1;
      if (after >= 0 && fs[after].sectionId === target.id) return [...fs.slice(0, after + 1), f, ...fs.slice(after + 1)];
      return [...fs, f];
    });
    setSelected({ type: 'field', id: f.key });
    touch();
  };
  const removeField = (key) => { setFields((fs) => fs.filter((f) => f.key !== key)); if (selected?.id === key) setSelected(null); touch(); };
  const duplicateField = (key) => {
    const at = fields.findIndex((f) => f.key === key);
    const copy = { ...fields[at], key: nextKey('f'), uid: undefined, checkpoint: `${fields[at].checkpoint} (copy)`, options: fields[at].options?.map((o) => ({ ...o })) ?? null };
    setFields((fs) => [...fs.slice(0, at + 1), copy, ...fs.slice(at + 1)]);
    setSelected({ type: 'field', id: copy.key });
    touch();
  };
  const moveField = (key, dir) => {
    setFields((fs) => {
      const f = fs.find((x) => x.key === key);
      const same = fs.filter((x) => x.sectionId === f.sectionId);
      const i = same.indexOf(f);
      const j = i + dir;
      if (j < 0 || j >= same.length) return fs;
      const a = fs.indexOf(same[i]);
      const b = fs.indexOf(same[j]);
      const out = [...fs];
      [out[a], out[b]] = [out[b], out[a]];
      return out;
    });
    touch();
  };
  /** Drag and drop: `key` lands before `beforeKey` (or at the end of `sectionId`); only between sections of the same kind. */
  const dropField = (key, sectionId, beforeKey = null) => {
    const f = fields.find((x) => x.key === key);
    const target = sections.find((s) => s.id === sectionId);
    if (!f || !target || target.kind !== f.section || key === beforeKey) return;
    setFields((fs) => {
      const rest = fs.filter((x) => x.key !== key);
      const moved = { ...f, sectionId };
      const at = beforeKey ? rest.findIndex((x) => x.key === beforeKey) : -1;
      if (at >= 0) return [...rest.slice(0, at), moved, ...rest.slice(at)];
      const last = rest.map((x) => x.sectionId).lastIndexOf(sectionId);
      return last >= 0 ? [...rest.slice(0, last + 1), moved, ...rest.slice(last + 1)] : [...rest, moved];
    });
    touch();
  };
  const moveSection = (sid, dir) => {
    setSections((ss) => {
      const s = ss.find((x) => x.id === sid);
      const same = sortSections(ss).filter((x) => x.kind === s.kind);
      const i = same.indexOf(s);
      const j = i + dir;
      if (j < 0 || j >= same.length) return ss;
      [same[i], same[j]] = [same[j], same[i]];
      return DISPLAY_SECTIONS.flatMap((k) => (k === s.kind ? same : ss.filter((x) => x.kind === k)));
    });
    touch();
  };
  const removeSection = (sid) => {
    const n = fields.filter((f) => f.sectionId === sid).length;
    if (n && !window.confirm(`Delete this section and its ${n} field${n === 1 ? '' : 's'}?`)) return;
    setSections((ss) => ss.filter((s) => s.id !== sid));
    setFields((fs) => fs.filter((f) => f.sectionId !== sid));
    setSelected(null);
    touch();
  };
  const applyStarter = (starter) => {
    const built = starter.build();
    setSections(built.sections);
    setFields(built.fields);
    setSelected({ type: 'field', id: built.fields[0]?.key });
    touch();
  };

  /** Problems the schema does not see: section headings must be unique per kind, and empty sections are dropped. */
  const layoutProblems = () => {
    const problems = [];
    for (const kind of SECTIONS) {
      const names = sections.filter((s) => s.kind === kind).map((s) => sectionTitle(s).trim().toLowerCase());
      if (new Set(names).size !== names.length) problems.push(`Two ${SECTION_LABELS[kind].toLowerCase()} sections have the same name. Give each its own name.`);
    }
    return problems;
  };

  const doSave = useCallback(async () => {
    setFormError('');
    const layout = layoutProblems();
    if (layout.length) { setFormError(layout[0]); return null; }
    const { checkpoints } = toPayload(sections, fields);
    const body = { ...header, checkpoints, rowVersion: rowVersion.current };
    const parsed = formatDraftSchema.safeParse(body);
    if (!parsed.success) {
      const next = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message;
      setErrors(next);
      const n = Object.keys(next).length;
      setFormError(`${n} field${n > 1 ? 's need' : ' needs'} attention (marked in red).`);
      const first = Object.keys(next).find((p) => p.startsWith('checkpoints.'));
      if (first) {
        const f = toPayload(sections, fields).ordered[Number(first.split('.')[1])];
        if (f) setSelected({ type: 'field', id: f.key });
      }
      return null;
    }
    try {
      const saved = await save({ id: v.id, ...parsed.data }).unwrap();
      rowVersion.current = saved.rowVersion;
      setErrors({});
      setDirty(false);
      // Take the server's uids so later saves update the same checkpoints; keep empty sections the user made.
      const back = fromVersion(saved.checkpoints);
      const keepEmpty = sections.filter((s) => !fields.some((f) => f.sectionId === s.id));
      setSections(sortSections([...back.sections, ...keepEmpty]));
      setFields(back.fields);
      setSelected(null);
      return saved;
    } catch (err) {
      const e = apiError(err);
      setErrors(e.fieldErrors);
      setFormError(e.message);
      return null;
    }
  }, [header, sections, fields, save, v.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const instruments = [...new Set([...(lookups?.instruments ?? []).map((i) => i.name), 'Visual', ...fields.map((f) => f.instrument).filter(Boolean)])];
  const units = [...new Set([...(lookups?.uoms ?? []).map((u) => u.code), 'mm', '°', 'kg', 'g', 'N', 'µm', ...fields.map((f) => f.uom).filter(Boolean)])];
  const selField = selected?.type === 'field' ? fields.find((f) => f.key === selected.id) : null;
  const selSection = selected?.type === 'section' ? sections.find((s) => s.id === selected.id) : selField ? sections.find((s) => s.id === selField.sectionId) : null;
  const total = fields.length;
  const errorCount = Object.keys(errorsByKey).length;

  return (
    <div className="pb-6">
      <PageHeader icon={Hammer} title={`Format builder · ${v.itemCode}`} subtitle={`${v.itemDescription} · ${v.baseVersionNo ? `changing v${v.baseVersionNo}` : 'first format'}${dirty ? ' · unsaved changes' : ''}`}>
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => (!dirty || window.confirm('Leave without saving your changes?')) && navigate(`/formats/versions/${v.id}`)}>Back</Button>
        <div role="tablist" className="flex p-0.5 rounded-lg bg-slate-100 text-xs">
          {[['build', 'Build', PencilLine], ['preview', 'Preview', Eye]].map(([k, l, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${mode === k ? 'bg-white text-blue-800 font-semibold ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon className="w-3.5 h-3.5" />{l}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" icon={Save} loading={saveState.isLoading} onClick={() => doSave().then((s) => s && toast.success('Draft saved'))}>Save draft</Button>
        <Button size="sm" icon={Send} loading={actState.isLoading} onClick={saveAndSubmit}>Save &amp; submit</Button>
      </PageHeader>

      <div className="p-4 sm:p-5 space-y-4">
        <FormError message={formError} />
        <section className="card p-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TextInput label="Format no." value={header.formatNo} onChange={(e) => { setHeader({ ...header, formatNo: e.target.value }); touch(); }} error={errors.formatNo} />
          <TextInput label="Common format no." hint="Same for all plants" value={header.commonFormatNo} onChange={(e) => { setHeader({ ...header, commonFormatNo: e.target.value }); touch(); }} error={errors.commonFormatNo} />
          <TextInput label="Reference standard" value={header.refStandard} onChange={(e) => { setHeader({ ...header, refStandard: e.target.value }); touch(); }} error={errors.refStandard} />
          <TextInput label="Remarks for the approver" value={header.remarks} onChange={(e) => { setHeader({ ...header, remarks: e.target.value }); touch(); }} error={errors.remarks} />
        </section>

        {mode === 'preview' ? <SheetPreview sections={ordered} fields={fields} /> : (
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_21rem] items-start">
            <Palette onAdd={addField} onAddSection={addSection} />

            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span><b className="text-slate-800">{total}</b> field{total === 1 ? '' : 's'} in <b className="text-slate-800">{sections.length}</b> section{sections.length === 1 ? '' : 's'}</span>
                {errorCount > 0 && <span className="inline-flex items-center gap-1 text-rose-600"><AlertCircle className="w-3.5 h-3.5" />{errorCount} with problems</span>}
                <span className="ml-auto">Drag fields to reorder · click one to set it up · Ctrl+S saves</span>
              </div>
              {!sections.length && <Starters onPick={applyStarter} />}
              {ordered.map((s) => (
                <SectionCard key={s.id} s={s} fields={fields.filter((f) => f.sectionId === s.id)} selected={selected} errorsByKey={errorsByKey}
                  canUp={ordered.filter((x) => x.kind === s.kind).indexOf(s) > 0} canDown={ordered.filter((x) => x.kind === s.kind).at(-1) !== s}
                  onSelect={setSelected} onRename={(label) => updateSection(s.id, { label })} onMove={(d) => moveSection(s.id, d)} onRemove={() => removeSection(s.id)}
                  onAdd={(type) => addField(s.kind, type)} onField={updateField} onMoveField={moveField} onDuplicate={duplicateField} onRemoveField={removeField} onDrop={dropField} />
              ))}
            </div>

            <aside className="xl:sticky xl:top-[calc(var(--page-header-h,0px)+1.25rem)] lg:col-span-2 xl:col-span-1">
              {selField ? (
                <FieldProperties key={selField.key} f={selField} section={selSection} sections={sections} errors={errorsByKey[selField.key] ?? {}} instruments={instruments} units={units}
                  onChange={(patch) => updateField(selField.key, patch)} onClose={() => setSelected(null)} />
              ) : selSection ? (
                <SectionProperties s={selSection} count={fields.filter((f) => f.sectionId === selSection.id).length} onRename={(label) => updateSection(selSection.id, { label })} onClose={() => setSelected(null)} />
              ) : (
                <div className="card p-5 text-sm text-slate-500">
                  <Settings2 className="w-5 h-5 text-slate-400 mb-2" />
                  Select a field or a section to set it up. Add fields from the palette on the left; each goes into the section you have selected, or into a new one of its kind.
                </div>
              )}
            </aside>
          </div>
        )}
        <datalist id="builder-instruments">{instruments.map((i) => <option key={i} value={i} />)}</datalist>
        <datalist id="builder-units">{units.map((u) => <option key={u} value={u} />)}</datalist>
      </div>
    </div>
  );
}

function Palette({ onAdd, onAddSection }) {
  return (
    <aside className="card p-3 lg:sticky lg:top-[calc(var(--page-header-h,0px)+1.25rem)] space-y-3" aria-label="Add a field">
      {PALETTE.map((group) => (
        <div key={group.title}>
          <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.title}</p>
          <ul className="space-y-1">
            {group.items.map((it) => {
              const [Icon, tone] = TYPE_LOOK[it.type];
              return (
                <li key={`${it.kind}-${it.type}`}>
                  <button type="button" onClick={() => onAdd(it.kind, it.type)} title={`Add: ${it.help}`}
                    className="w-full flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-slate-200 hover:bg-slate-50 cursor-pointer group">
                    <span className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center ${tone}`}><Icon className="w-3.5 h-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800">{it.label}</span>
                      <span className="block text-[11px] text-slate-400 truncate">{it.help}</span>
                    </span>
                    <Plus className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-600" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="border-t border-slate-100 pt-3">
        <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">New section</p>
        <div className="grid grid-cols-2 gap-1.5">
          {DISPLAY_SECTIONS.map((k) => (
            <button key={k} type="button" onClick={() => onAddSection(k)} title={KIND_HELP[k]}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
              <span className={`w-1.5 h-3.5 rounded-full ${SECTION_TONE[k]}`} />{SECTION_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Starters({ onPick }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1"><LayoutTemplate className="w-5 h-5 text-blue-600" /><h2 className="text-base font-bold text-slate-900">Start your inspection report</h2></div>
      <p className="text-sm text-slate-500 mb-4">Pick a starting layout and change anything, or add fields from the palette to build it from scratch.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <button key={s.key} type="button" onClick={() => onPick(s)} className="rounded-xl border border-slate-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer">
            <span className="block text-sm font-semibold text-slate-900">{s.title}</span>
            <span className="block text-xs text-slate-500 mt-0.5">{s.help}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SectionCard({ s, fields, selected, errorsByKey, canUp, canDown, onSelect, onRename, onMove, onRemove, onAdd, onField, onMoveField, onDuplicate, onRemoveField, onDrop }) {
  const [over, setOver] = useState(false);
  const on = selected?.type === 'section' && selected.id === s.id;
  return (
    <section className={`card overflow-hidden ${on ? 'ring-2 ring-blue-400' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(`qmas/${s.kind.toLowerCase()}`)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const key = e.dataTransfer.getData('text/plain'); if (key) onDrop(key, s.id); }}>
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <span className={`w-1.5 h-5 rounded-full ${SECTION_TONE[s.kind]}`} />
        <input value={s.label} placeholder={SECTION_LABELS[s.kind]} onChange={(e) => onRename(e.target.value)} onFocus={() => onSelect({ type: 'section', id: s.id })} aria-label="Section name"
          className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-800 placeholder:text-slate-800 rounded px-1 py-0.5 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
        <span className="hidden sm:inline text-[11px] text-slate-400">{SECTION_LABELS[s.kind]} · {fields.length}</span>
        <IconBtn label="Section settings" icon={Settings2} onClick={() => onSelect({ type: 'section', id: s.id })} />
        <IconBtn label="Move section up" icon={ArrowUp} onClick={() => onMove(-1)} disabled={!canUp} />
        <IconBtn label="Move section down" icon={ArrowDown} onClick={() => onMove(1)} disabled={!canDown} />
        <IconBtn label="Delete section" icon={Trash2} tone="danger" onClick={onRemove} />
      </div>
      <ul className={`divide-y divide-slate-100 ${over ? 'bg-blue-50/40' : ''}`}>
        {fields.map((f, i) => (
          <FieldRow key={f.key} f={f} n={i + 1} last={i === fields.length - 1} kind={s.kind} sectionId={s.id} selected={selected?.type === 'field' && selected.id === f.key} errors={errorsByKey[f.key]}
            onSelect={() => onSelect({ type: 'field', id: f.key })} onChange={(patch) => onField(f.key, patch)} onMove={(d) => onMoveField(f.key, d)}
            onDuplicate={() => onDuplicate(f.key)} onRemove={() => onRemoveField(f.key)} onDrop={onDrop} />
        ))}
        {!fields.length && <li className="px-4 py-5 text-center text-sm text-slate-400">Empty section. Add a field below or drag one here.</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-slate-100 bg-white">
        {INPUT_TYPES[s.kind].map((t) => (
          <button key={t} type="button" onClick={() => onAdd(t)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 cursor-pointer">
            <Plus className="w-3.5 h-3.5" />{INPUT_TYPE_LABELS[t]}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-400">{KIND_HELP[s.kind]}</span>
      </div>
    </section>
  );
}

const inlineCls = (err) => `w-full min-w-0 px-2 py-1 rounded-md border text-sm ${err ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'} focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400`;

function FieldRow({ f, n, last, kind, sectionId, selected, errors, onSelect, onChange, onMove, onDuplicate, onRemove, onDrop }) {
  const [dragOver, setDragOver] = useState(false);
  const measure = f.inputType === 'MEASURE';
  const e = errors ?? {};
  const summary = measure ? null : f.section === 'RECORD' || f.inputType === 'CHOICE' ? ruleText(f) : f.specification || (f.section === 'RELIABILITY' && f.frequencyMonths ? `every ${f.frequencyMonths} months` : '');
  return (
    <li draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', f.key); ev.dataTransfer.setData(`qmas/${kind.toLowerCase()}`, '1'); ev.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(ev) => { if (ev.dataTransfer.types.includes(`qmas/${kind.toLowerCase()}`)) { ev.preventDefault(); ev.stopPropagation(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); setDragOver(false); const key = ev.dataTransfer.getData('text/plain'); if (key) onDrop(key, sectionId, f.key); }}
      onClick={onSelect}
      className={`group flex items-start gap-2 px-2 py-2 cursor-pointer ${selected ? 'bg-blue-50/70' : 'hover:bg-slate-50'} ${dragOver ? 'border-t-2 border-blue-500' : ''} ${Object.keys(e).length ? 'border-l-2 border-l-rose-500' : ''}`}>
      <GripVertical className="w-4 h-4 mt-1.5 shrink-0 text-slate-300 cursor-grab" aria-hidden="true" />
      <span className="w-5 mt-1.5 shrink-0 text-xs text-slate-400 tabular">{n}</span>
      <div className="min-w-0 flex-1 grid gap-1.5 sm:grid-cols-[minmax(8rem,1.2fr)_minmax(0,2fr)] items-start">
        <div className="min-w-0">
          <input value={f.checkpoint} onChange={(ev) => onChange({ checkpoint: ev.target.value })} onClick={(ev) => ev.stopPropagation()} onFocus={onSelect}
            placeholder={f.section === 'RECORD' ? 'e.g. Batch no.' : 'Check point'} aria-label={`Field ${n} name`} aria-invalid={!!e.checkpoint} className={inlineCls(e.checkpoint)} />
          {Object.values(e)[0] && <span className="block mt-0.5 text-[11px] text-rose-600">{Object.values(e)[0]}</span>}
        </div>
        {measure ? (
          <div className="grid grid-cols-[minmax(0,1.6fr)_4.5rem_4.5rem_3.5rem] gap-1.5" onClick={(ev) => ev.stopPropagation()}>
            <input value={f.specification} placeholder="e.g. 57 ± 0.3" aria-label={`Field ${n} specification`} onFocus={onSelect} onChange={(ev) => onChange({ specification: ev.target.value })}
              onBlur={() => { const p = parseSpec(f.specification); if (p && f.lsl === '' && f.usl === '') onChange({ nominal: p.nominal === null ? f.nominal : String(p.nominal), lsl: p.lsl === null ? '' : String(p.lsl), usl: p.usl === null ? '' : String(p.usl) }); }}
              className={inlineCls(e.specification)} />
            <input value={f.lsl} placeholder="LSL" inputMode="decimal" aria-label={`Field ${n} LSL`} onFocus={onSelect} onChange={(ev) => onChange({ lsl: ev.target.value.replace(/[^\d.-]/g, '') })} className={`${inlineCls(e.lsl)} text-right tabular`} />
            <input value={f.usl} placeholder="USL" inputMode="decimal" aria-label={`Field ${n} USL`} onFocus={onSelect} onChange={(ev) => onChange({ usl: ev.target.value.replace(/[^\d.-]/g, '') })} className={`${inlineCls(e.usl)} text-right tabular`} />
            <input value={f.uom} placeholder="Unit" list="builder-units" aria-label={`Field ${n} unit`} onFocus={onSelect} onChange={(ev) => onChange({ uom: ev.target.value })} className={inlineCls(e.uom)} />
          </div>
        ) : (
          <div className="min-w-0 flex items-center gap-2 pt-1">
            <TypeChip type={f.inputType} />
            <span className={`truncate text-xs ${summary ? 'text-slate-600' : 'text-slate-400 italic'}`}>{summary || 'Set it up in the panel →'}</span>
            {f.section === 'RECORD' && !f.isRequired && <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-400">optional</span>}
          </div>
        )}
      </div>
      <div className="flex shrink-0 opacity-60 group-hover:opacity-100" onClick={(ev) => ev.stopPropagation()}>
        <IconBtn label="Move up" icon={ArrowUp} onClick={() => onMove(-1)} disabled={n === 1} />
        <IconBtn label="Move down" icon={ArrowDown} onClick={() => onMove(1)} disabled={last} />
        <IconBtn label="Duplicate" icon={Copy} onClick={onDuplicate} />
        <IconBtn label="Delete" icon={Trash2} tone="danger" onClick={onRemove} />
      </div>
    </li>
  );
}

function PanelShell({ title, sub, onClose, children }) {
  return (
    <section className="card">
      <div className="flex items-start gap-2 px-4 pt-3.5 pb-2 border-b border-slate-100">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
        </div>
        <IconBtn label="Close" icon={X} onClick={onClose} />
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

const Lbl = ({ children, hint }) => <span className="block text-xs font-medium text-slate-600 mb-1">{children}{hint && <span className="font-normal text-slate-400"> · {hint}</span>}</span>;
const Err = ({ msg }) => (msg ? <span className="block mt-1 text-[11px] text-rose-600">{msg}</span> : null);

function Input({ label, hint, error, ...props }) {
  return (
    <label className="block">
      <Lbl hint={hint}>{label}</Lbl>
      <input {...props} aria-invalid={!!error} className={inlineCls(error)} />
      <Err msg={error} />
    </label>
  );
}

function FieldProperties({ f, section, sections, errors, onChange, onClose }) {
  const kindSections = sortSections(sections).filter((s) => s.kind === f.section);
  const limits = f.inputType === 'MEASURE' || f.inputType === 'NUMBER';
  const choice = f.inputType === 'CHOICE' || f.inputType === 'YES_NO';
  const setType = (t) => {
    const patch = { inputType: t };
    if (t === 'YES_NO') patch.options = yesNoOptions('YES');
    else if (t === 'CHOICE' && !(f.options?.length > 2 || f.inputType === 'CHOICE')) patch.options = defaultsFor(f.section, 'CHOICE').options;
    else if (t !== 'CHOICE') patch.options = null;
    if (t !== 'NUMBER' && f.section === 'RECORD') Object.assign(patch, { lsl: '', usl: '', nominal: '' });
    onChange(patch);
  };
  const opts = f.options ?? [];
  const setOpt = (i, patch) => onChange({ options: opts.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const spec = parseSpec(f.specification);

  return (
    <PanelShell title={f.checkpoint || 'New field'} sub={`${sectionTitle(section)} · ${INPUT_TYPE_LABELS[f.inputType]}`} onClose={onClose}>
      <Input label={f.section === 'RECORD' ? 'Detail' : 'Check point'} value={f.checkpoint} onChange={(e) => onChange({ checkpoint: e.target.value })} error={errors.checkpoint} maxLength={200} />
      {INPUT_TYPES[f.section].length > 1 && (
        <div>
          <Lbl>Field type</Lbl>
          <div className="flex flex-wrap gap-1.5">
            {INPUT_TYPES[f.section].map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} aria-pressed={f.inputType === t}
                className={`rounded-lg border px-2 py-1 cursor-pointer ${f.inputType === t ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : 'border-slate-200 hover:bg-slate-50'}`}>
                <TypeChip type={t} />
              </button>
            ))}
          </div>
          <Err msg={errors.inputType} />
        </div>
      )}
      {kindSections.length > 1 && (
        <label className="block">
          <Lbl>Section</Lbl>
          <select value={f.sectionId} onChange={(e) => onChange({ sectionId: e.target.value })} className={`${inlineCls(false)} cursor-pointer`}>
            {kindSections.map((s) => <option key={s.id} value={s.id}>{sectionTitle(s)}</option>)}
          </select>
        </label>
      )}
      {f.section !== 'RECORD' || f.inputType === 'TEXT' ? (
        <Input label={f.section === 'RECORD' ? 'Instructions / expected' : 'Specification'} hint={f.section === 'DIMENSIONAL' ? 'e.g. 57 ± 0.3 fills the limits' : undefined}
          value={f.specification} onChange={(e) => onChange({ specification: e.target.value })} error={errors.specification} maxLength={500} />
      ) : null}
      {limits && (
        <div>
          <div className="grid grid-cols-3 gap-2">
            <Input label="Nominal" inputMode="decimal" value={f.nominal} onChange={(e) => onChange({ nominal: e.target.value.replace(/[^\d.-]/g, '') })} error={errors.nominal} />
            <Input label="LSL" inputMode="decimal" value={f.lsl} onChange={(e) => onChange({ lsl: e.target.value.replace(/[^\d.-]/g, '') })} error={errors.lsl} />
            <Input label="USL" inputMode="decimal" value={f.usl} onChange={(e) => onChange({ usl: e.target.value.replace(/[^\d.-]/g, '') })} error={errors.usl} />
          </div>
          {f.inputType === 'MEASURE' && spec && (
            <button type="button" onClick={() => onChange({ nominal: spec.nominal === null ? f.nominal : String(spec.nominal), lsl: spec.lsl === null ? '' : String(spec.lsl), usl: spec.usl === null ? '' : String(spec.usl) })}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline cursor-pointer"><Wand2 className="w-3.5 h-3.5" />Fill limits from "{f.specification}"</button>
          )}
          {f.inputType === 'NUMBER' && <p className="mt-1 text-[11px] text-slate-400">Leave LSL and USL empty to only record the number; with limits, a value outside makes the lot Not OK.</p>}
        </div>
      )}
      {(limits || f.section === 'RELIABILITY') && <Input label="Unit" list="builder-units" value={f.uom} onChange={(e) => onChange({ uom: e.target.value })} error={errors.uom} maxLength={20} />}
      {f.section !== 'RECORD' && <Input label="Instrument / method" list="builder-instruments" value={f.instrument} onChange={(e) => onChange({ instrument: e.target.value })} error={errors.instrument} maxLength={100} />}
      {f.section === 'RELIABILITY' && (
        <Input label="Test every (months)" hint="empty: every lot" inputMode="numeric" value={f.frequencyMonths} onChange={(e) => onChange({ frequencyMonths: e.target.value.replace(/\D/g, '') })} error={errors.frequencyMonths} />
      )}
      {choice && (
        <div>
          <Lbl hint="tick = passes">Options</Lbl>
          <ul className="space-y-1.5">
            {opts.map((o, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <button type="button" onClick={() => setOpt(i, { pass: !o.pass })} aria-label={o.pass ? `${o.label} passes (click to make it fail)` : `${o.label} fails (click to make it pass)`}
                  className={`shrink-0 w-14 rounded-md px-1.5 py-1 text-[11px] font-bold cursor-pointer ${o.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{o.pass ? 'PASS' : 'FAIL'}</button>
                <input value={o.label} disabled={f.inputType === 'YES_NO'} onChange={(e) => setOpt(i, { label: e.target.value })} aria-label={`Option ${i + 1}`} className={`${inlineCls(false)} disabled:bg-slate-50`} maxLength={60} />
                {f.inputType === 'CHOICE' && (
                  <>
                    <IconBtn label="Move option up" icon={ArrowUp} disabled={i === 0} onClick={() => onChange({ options: opts.map((x, j) => (j === i - 1 ? opts[i] : j === i ? opts[i - 1] : x)) })} />
                    <IconBtn label="Remove option" icon={Trash2} tone="danger" disabled={opts.length <= 2} onClick={() => onChange({ options: opts.filter((_, j) => j !== i) })} />
                  </>
                )}
              </li>
            ))}
          </ul>
          {f.inputType === 'CHOICE' && opts.length < 12 && (
            <button type="button" onClick={() => onChange({ options: [...opts, { label: `Option ${opts.length + 1}`, pass: true }] })} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline cursor-pointer"><Plus className="w-3.5 h-3.5" />Add option</button>
          )}
          <Err msg={errors.options} />
          {f.section === 'RECORD' && !opts.some((o) => !o.pass) && <p className="mt-1 text-[11px] text-slate-400">No option fails, so this only records the answer.</p>}
        </div>
      )}
      {f.section === 'RECORD' && (
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={f.isRequired} onChange={(e) => onChange({ isRequired: e.target.checked })} />
          Required before the inspection can be submitted
        </label>
      )}
      <Input label="Help for the inspector" hint="shown on the sheet" value={f.helpText} onChange={(e) => onChange({ helpText: e.target.value })} error={errors.helpText} maxLength={300} />
    </PanelShell>
  );
}

function SectionProperties({ s, count, onRename, onClose }) {
  return (
    <PanelShell title={sectionTitle(s)} sub={`${SECTION_LABELS[s.kind]} section · ${count} field${count === 1 ? '' : 's'}`} onClose={onClose}>
      <Input label="Section name" hint="shown as the heading on the sheet" value={s.label} placeholder={SECTION_LABELS[s.kind]} onChange={(e) => onRename(e.target.value)} maxLength={60} />
      <p className="text-xs text-slate-500">{KIND_HELP[s.kind]}</p>
      <p className="text-xs text-slate-400">Fields can be dragged between sections of the same kind. A section without fields is not saved.</p>
    </PanelShell>
  );
}

/** How the inspector will see the sheet, with a few sample columns. Nothing here is saved. */
function SheetPreview({ sections, fields }) {
  const [n, setN] = useState(3);
  const samples = Array.from({ length: n }, (_, i) => i + 1);
  const visible = sections.filter((s) => fields.some((f) => f.sectionId === s.id));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
        <Eye className="w-4 h-4" />Preview of the inspection sheet. Try it out; nothing is saved.
        <label className="ml-auto flex items-center gap-2 text-xs">Sample size
          <select value={n} onChange={(e) => setN(Number(e.target.value))} className="rounded-md border border-blue-200 bg-white px-2 py-1 cursor-pointer">
            {[1, 2, 3, 5, 8].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      </div>
      {!visible.length && <p className="card p-8 text-center text-sm text-slate-500">Add fields to see the sheet.</p>}
      {visible.map((s) => {
        const list = fields.filter((f) => f.sectionId === s.id);
        return (
          <section key={s.id} className="card overflow-hidden">
            <h3 className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-800 bg-slate-50 border-b border-slate-200"><span className={`w-1.5 h-4 rounded-full ${SECTION_TONE[s.kind]}`} />{sectionTitle(s)}</h3>
            {s.kind === 'RECORD' ? (
              <div className="p-4 grid gap-4 sm:grid-cols-2">
                {list.map((f) => (
                  <label key={f.key} className="block">
                    <span className="block text-xs font-medium text-slate-700 mb-1">{f.checkpoint || 'Untitled'}{f.isRequired && <span className="text-rose-500"> *</span>}</span>
                    {f.inputType === 'YES_NO' || f.inputType === 'CHOICE' ? (
                      <select className={`${inlineCls(false)} cursor-pointer`} defaultValue=""><option value="">Choose…</option>{(f.options ?? []).map((o) => <option key={o.label}>{o.label}</option>)}</select>
                    ) : <input type={f.inputType === 'DATE' ? 'date' : 'text'} inputMode={f.inputType === 'NUMBER' ? 'decimal' : undefined} placeholder={f.inputType === 'NUMBER' ? ruleText(f) : f.specification} className={inlineCls(false)} />}
                    {f.helpText && <span className="block mt-1 text-[11px] text-slate-400">{f.helpText}</span>}
                  </label>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Check point</th>
                      <th className="px-3 py-2 text-left">Requirement</th>
                      {s.kind === 'RELIABILITY' ? <th className="px-3 py-2 text-left">Observation</th> : samples.map((x) => <th key={x} className="px-2 py-2 w-24">X{x}</th>)}
                      <th className="px-3 py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {list.map((f) => (
                      <tr key={f.key}>
                        <td className="px-3 py-2 font-medium text-slate-800">{f.checkpoint || 'Untitled'}{f.helpText && <span className="block text-[11px] font-normal text-slate-400">{f.helpText}</span>}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{f.inputType === 'MEASURE' ? `${f.lsl || '–'} … ${f.usl || '–'} ${f.uom}` : f.inputType === 'CHOICE' ? ruleText(f) : f.specification}</td>
                        {s.kind === 'RELIABILITY' ? (
                          <td className="px-3 py-2"><input className={inlineCls(false)} placeholder="Observation" /></td>
                        ) : samples.map((x) => (
                          <td key={x} className="px-1.5 py-1.5">
                            {f.inputType === 'MEASURE' ? <input inputMode="decimal" placeholder={`X${x}`} className={`${inlineCls(false)} text-right`} />
                              : f.inputType === 'CHOICE' ? <select className={`${inlineCls(false)} cursor-pointer text-xs`} defaultValue=""><option value="">–</option>{(f.options ?? []).map((o) => <option key={o.label}>{o.label}</option>)}</select>
                                : <span className="flex gap-1"><span className="rounded border border-emerald-200 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">OK</span><span className="rounded border border-rose-200 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">NOK</span></span>}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center text-xs text-slate-400">auto</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
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
