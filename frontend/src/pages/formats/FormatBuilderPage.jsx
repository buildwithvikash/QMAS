import {
  DISPLAY_SECTIONS, formatDraftSchema, INPUT_TYPE_LABELS, INPUT_TYPES, parseSpec, SECTION_LABELS, SECTIONS, yesNoOptions,
} from '@qmas/shared';
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronUp, ClipboardPaste, Copy, Eye, FileText, GripVertical, Hammer, LayoutTemplate, List, PencilLine, Plus, Save,
  Search, Send, Settings2, Table2, Trash2, Wand2, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCreateDraftMutation, useFormatActionMutation, useGetFormatVersionQuery, useSaveDraftMutation } from '../../api/formatsApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import { askConfirm } from '../../app/confirm.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';

import { groupCheckpoints, ruleText } from './formatHelpers.js';
import { SECTION_LOOK, SECTION_TONE, TYPE_LOOK } from './formatLook.js';
import { TypeChip } from './formatUi.jsx';
import InspectorView from './InspectorView.jsx';

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
  { title: 'Lot details', note: 'Recorded once per lot', items: [
    { kind: 'RECORD', type: 'TEXT', label: 'Text', help: 'Batch no., heat no., remarks' },
    { kind: 'RECORD', type: 'NUMBER', label: 'Number', help: 'Optional limits decide OK' },
    { kind: 'RECORD', type: 'DATE', label: 'Date', help: 'Manufacture, expiry…' },
    { kind: 'RECORD', type: 'YES_NO', label: 'Yes / No', help: 'e.g. Test certificate received' },
    { kind: 'RECORD', type: 'CHOICE', label: 'Dropdown', help: 'Pick one option' },
  ] },
  { title: 'Inspection fields', note: 'Checked on the samples', items: [
    { kind: 'DIMENSIONAL', type: 'MEASURE', label: 'Measurement', help: 'Reading against LSL / USL' },
    { kind: 'VISUAL', type: 'OK_NOK', label: 'OK / Not OK', help: 'Tick per sample' },
    { kind: 'VISUAL', type: 'CHOICE', label: 'Choice per sample', help: 'Options that pass or fail' },
    { kind: 'RELIABILITY', type: 'LOT_TEST', label: 'Reliability test', help: 'Observation + OK / Not OK' },
  ] },
];
const SECTION_SUB = {
  RECORD: 'Details recorded once for the lot (batch no., certificates, dates)',
  DIMENSIONAL: 'Measurement parameters with tolerances and sample readings',
  VISUAL: 'Visual inspection checks on each sample',
  RELIABILITY: 'Reliability / functional tests on the lot',
};
const FREQUENCIES = [['', 'Every lot'], ['1', 'Monthly'], ['3', 'Every 3 months'], ['6', 'Every 6 months'], ['12', 'Yearly'], ['24', 'Every 2 years']];

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

/** What changes when a field's type changes (options, limits). */
function typePatch(f, t) {
  const patch = { inputType: t };
  if (t === 'YES_NO') patch.options = yesNoOptions('YES');
  else if (t === 'CHOICE' && !(f.options?.length > 2 || f.inputType === 'CHOICE')) patch.options = defaultsFor(f.section, 'CHOICE').options;
  else if (t !== 'CHOICE') patch.options = null;
  if (t !== 'NUMBER' && f.section === 'RECORD') Object.assign(patch, { lsl: '', usl: '', nominal: '' });
  return patch;
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
  const [views, setViews] = useState({}); // section id → 'table' | 'list'
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [infoOpen, setInfoOpen] = useState(true);
  const [pasteTo, setPasteTo] = useState(null); // section id
  const [paletteQ, setPaletteQ] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(initial.changed);
  const [save, saveState] = useSaveDraftMutation();
  const [act, actState] = useFormatActionMutation();
  const [createDraft, freshState] = useCreateDraftMutation();
  // A draft started before the current version was approved does not contain it: offer a fresh start.
  const outdated = v.behindCurrent && v.currentVersionNo;
  const startFresh = async () => {
    const empty = v.checkpoints.length === 0;
    if (!empty && !(await askConfirm({
      title: `Start again from v${v.currentVersionNo}?`,
      message: `A new draft is started from approved v${v.currentVersionNo}. This draft stays in the list; discard it there if you no longer need it.`,
      confirmLabel: `Start from v${v.currentVersionNo}`,
      variant: 'primary',
    }))) return;
    try {
      const fresh = await createDraft({ itemId: Number(v.itemId), from: 'CURRENT' }).unwrap();
      if (empty && v.allowedActions.includes('discard')) await act({ id: v.id, action: 'discard', rowVersion: v.rowVersion }).unwrap().catch(() => {});
      toast.success(`Draft started from v${v.currentVersionNo}`);
      navigate(`/formats/versions/${fresh.id}/edit`, { replace: true });
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
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
  const removeSection = async (sid) => {
    const n = fields.filter((f) => f.sectionId === sid).length;
    if (n && !(await askConfirm({
      title: 'Delete this section?',
      message: `The section and its ${n} field${n === 1 ? '' : 's'} are removed from this draft. Nothing is saved until you save the draft.`,
      confirmLabel: 'Delete section',
    }))) return;
    setSections((ss) => ss.filter((s) => s.id !== sid));
    setFields((fs) => fs.filter((f) => f.sectionId !== sid));
    setSelected(null);
    touch();
  };
  const duplicateSection = (sid) => {
    const src = sections.find((x) => x.id === sid);
    const copy = { id: nextKey('s'), kind: src.kind, label: `${sectionTitle(src)} (copy)` };
    const copies = fields.filter((f) => f.sectionId === sid).map((f) => ({ ...f, key: nextKey('f'), uid: undefined, sectionId: copy.id, options: f.options?.map((o) => ({ ...o })) ?? null }));
    setSections((ss) => [...ss, copy]);
    setFields((fs) => [...fs, ...copies]);
    setSelected({ type: 'section', id: copy.id });
    touch();
  };
  const toggleCollapse = (sid) => setCollapsed((c) => {
    const n = new Set(c);
    if (n.has(sid)) n.delete(sid); else n.add(sid);
    return n;
  });
  /** Measurements pasted from Excel (tab-separated rows) go to the end of the section. */
  const pasteMeasurements = (sid, rows) => {
    const added = rows.map((r) => ({ ...defaultsFor('DIMENSIONAL', 'MEASURE'), ...r, sectionId: sid }));
    setFields((fs) => {
      const last = fs.map((x) => x.sectionId).lastIndexOf(sid);
      return last >= 0 ? [...fs.slice(0, last + 1), ...added, ...fs.slice(last + 1)] : [...fs, ...added];
    });
    setPasteTo(null);
    touch();
    toast.success(`${added.length} measurement${added.length === 1 ? '' : 's'} added`);
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
      <PageHeader icon={Hammer} title={`Format builder · ${v.itemCode}`} subtitle={`${v.itemDescription} · ${v.baseVersionNo ? `changing v${v.baseVersionNo}` : v.currentVersionNo ? `started before v${v.currentVersionNo}` : 'first format'}${dirty ? ' · unsaved changes' : ''}`}>
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={async () => (!dirty || await askConfirm({ title: 'Leave without saving?', message: 'Your changes to this draft are not saved yet.', confirmLabel: 'Leave without saving' })) && navigate(`/formats/versions/${v.id}`)}>Back</Button>
        <div role="tablist" className="flex p-0.5 rounded-lg bg-slate-100 text-xs">
          {[['build', 'Build', PencilLine], ['preview', 'Preview', Eye]].map(([k, l, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer ${mode === k ? 'bg-white text-blue-800 font-semibold ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon className="w-3.5 h-3.5" />{l}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" icon={Save} loading={saveState.isLoading} onClick={() => doSave().then((s) => s && toast.success('Draft saved'))}>Save draft</Button>
        <span className="inline-flex"><Button size="sm" icon={Send} loading={actState.isLoading} onClick={saveAndSubmit}>Save &amp; submit</Button></span>
      </PageHeader>

      <div className="p-4 sm:p-5 space-y-4">
        {outdated && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="min-w-0 flex-1">
              {v.baseVersionNo ? `This draft was started from v${v.baseVersionNo}.` : 'This draft was started before any format was approved.'}{' '}
              <strong>v{v.currentVersionNo} is now approved</strong> and is not in this draft{v.checkpoints.length ? '; on approval both sets of changes are merged.' : '.'}
            </span>
            <Button size="sm" loading={freshState.isLoading} onClick={startFresh}>Start from v{v.currentVersionNo}</Button>
          </div>
        )}
        <FormError message={formError} />

        {mode === 'preview' ? (
          <>
            <FormatInfo header={header} errors={errors} open={infoOpen} onToggle={() => setInfoOpen((o) => !o)} onChange={(patch) => { setHeader({ ...header, ...patch }); touch(); }} />
            <InspectorPreview sections={sections} fields={fields} />
          </>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem] items-start">
            <Palette q={paletteQ} onQ={setPaletteQ} onAdd={addField} onAddSection={addSection} />

            <div className="space-y-4 min-w-0">
              <FormatInfo header={header} errors={errors} open={infoOpen} onToggle={() => setInfoOpen((o) => !o)} onChange={(patch) => { setHeader({ ...header, ...patch }); touch(); }} />
              <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-slate-500">
                <span><b className="text-slate-800">{total}</b> field{total === 1 ? '' : 's'} in <b className="text-slate-800">{sections.length}</b> section{sections.length === 1 ? '' : 's'}</span>
                {errorCount > 0 && <span className="inline-flex items-center gap-1 text-rose-600"><AlertCircle className="w-3.5 h-3.5" />{errorCount} with problems</span>}
                <span className="ml-auto">Type in the table · drag rows to reorder · click a row for its settings · Ctrl+S saves</span>
              </div>
              {!sections.length && <Starters onPick={applyStarter} />}
              {ordered.map((sec, i) => (
                <SectionCard key={sec.id} n={i + 1} s={sec} fields={fields.filter((f) => f.sectionId === sec.id)} selected={selected} errorsByKey={errorsByKey}
                  view={views[sec.id] ?? 'table'} onView={(vw) => setViews((x) => ({ ...x, [sec.id]: vw }))}
                  collapsed={collapsed.has(sec.id)} onCollapse={() => toggleCollapse(sec.id)}
                  canUp={ordered.filter((x) => x.kind === sec.kind).indexOf(sec) > 0} canDown={ordered.filter((x) => x.kind === sec.kind).at(-1) !== sec}
                  onSelect={setSelected} onRename={(label) => updateSection(sec.id, { label })} onMove={(d) => moveSection(sec.id, d)} onRemove={() => removeSection(sec.id)}
                  onDuplicateSection={() => duplicateSection(sec.id)} onPaste={() => setPasteTo(sec.id)}
                  onAdd={(type) => addField(sec.kind, type)} onField={updateField} onMoveField={moveField} onDuplicate={duplicateField} onRemoveField={removeField} onDrop={dropField} />
              ))}
              {sections.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-3">
                  <span className="text-xs font-semibold text-slate-500">Add a section:</span>
                  {DISPLAY_SECTIONS.map((k) => {
                    const [Icon, tone] = SECTION_LOOK[k];
                    return (
                      <button key={k} type="button" onClick={() => addSection(k)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer">
                        <span className={`grid h-5 w-5 place-items-center rounded ${tone}`}><Icon className="h-3 w-3" /></span>{SECTION_LABELS[k]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <aside className="xl:sticky xl:top-[calc(var(--page-header-h,0px)+1.25rem)] lg:col-span-2 xl:col-span-1">
              {selField ? (
                <FieldProperties key={selField.key} f={selField} section={selSection} sections={sections} errors={errorsByKey[selField.key] ?? {}} instruments={instruments} units={units}
                  onChange={(patch) => updateField(selField.key, patch)} onClose={() => setSelected(null)} onDelete={() => removeField(selField.key)} />
              ) : selSection ? (
                <SectionProperties s={selSection} count={fields.filter((f) => f.sectionId === selSection.id).length} onRename={(label) => updateSection(selSection.id, { label })} onClose={() => setSelected(null)} onDelete={() => removeSection(selSection.id)} />
              ) : (
                <div className="card p-5 text-sm text-slate-500">
                  <p className="mb-2 flex items-center gap-2 font-bold text-slate-900"><Settings2 className="w-4 h-4 text-slate-400" />Field settings</p>
                  Click a row to set it up here: type, limits, options, help for the inspector. Add fields from the palette; each goes into the section you have selected, or into a new one of its kind.
                </div>
              )}
            </aside>
          </div>
        )}
        {pasteTo && <PasteDialog onClose={() => setPasteTo(null)} onAdd={(rows) => pasteMeasurements(pasteTo, rows)} />}
        <datalist id="builder-instruments">{instruments.map((i) => <option key={i} value={i} />)}</datalist>
        <datalist id="builder-units">{units.map((u) => <option key={u} value={u} />)}</datalist>
      </div>
    </div>
  );
}

function Palette({ q, onQ, onAdd, onAddSection }) {
  const needle = q.trim().toLowerCase();
  const hit = (...t) => !needle || t.some((x) => x.toLowerCase().includes(needle));
  const item = (key, onClick, Icon, tone, label, help) => (
    <li key={key}>
      <button type="button" onClick={onClick} title={`Add: ${help}`}
        className="w-full flex items-center gap-2.5 rounded-lg border border-slate-200/70 bg-white px-2 py-1.5 text-left hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer group">
        <span className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center ${tone}`}><Icon className="w-3.5 h-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-800">{label}</span>
          <span className="block text-[11px] text-slate-400 truncate">{help}</span>
        </span>
        <Plus className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-600" />
      </button>
    </li>
  );
  const groups = PALETTE.map((g) => ({ ...g, items: g.items.filter((it) => hit(it.label, it.help)) })).filter((g) => g.items.length);
  const sectionItems = DISPLAY_SECTIONS.filter((k) => hit(SECTION_LABELS[k], 'section', SECTION_SUB[k]));
  return (
    <aside className="card p-3 lg:sticky lg:top-[calc(var(--page-header-h,0px)+1.25rem)] space-y-3" aria-label="Field palette">
      <p className="flex items-center gap-2 px-1 text-sm font-bold text-slate-900"><LayoutTemplate className="h-4 w-4 text-blue-600" />Field palette</p>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Search fields…" aria-label="Search fields"
          className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15" />
      </label>
      {groups.map((group) => (
        <div key={group.title}>
          <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.title} <span className="font-normal normal-case tracking-normal">· {group.note}</span></p>
          <ul className="space-y-1">
            {group.items.map((it) => {
              const [Icon, tone] = TYPE_LOOK[it.type];
              return item(`${it.kind}-${it.type}`, () => onAdd(it.kind, it.type), Icon, tone, it.label, it.help);
            })}
          </ul>
        </div>
      ))}
      {sectionItems.length > 0 && (
        <div>
          <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sections</p>
          <ul className="space-y-1">
            {sectionItems.map((k) => {
              const [Icon, tone] = SECTION_LOOK[k];
              return item(`sec-${k}`, () => onAddSection(k), Icon, tone, `${SECTION_LABELS[k]} section`, SECTION_SUB[k]);
            })}
          </ul>
        </div>
      )}
      {!groups.length && !sectionItems.length && <p className="px-1 py-3 text-center text-xs text-slate-400">No field matches.</p>}
    </aside>
  );
}

/** Format no., common format no., reference standard and remarks, folded away when not needed. */
function FormatInfo({ header, errors, open, onToggle, onChange }) {
  return (
    <section className="card">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-3 text-left cursor-pointer">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-600 text-white"><FileText className="h-3.5 w-3.5" /></span>
        <span className="text-sm font-bold text-slate-900">Format information</span>
        {!open && <span className="truncate text-xs text-slate-500">{[header.formatNo, header.commonFormatNo, header.refStandard].filter(Boolean).join(' · ') || 'Not filled yet'}</span>}
        <span className="ml-auto text-slate-400">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <TextInput label="Format no." placeholder="Enter format number" value={header.formatNo} onChange={(e) => onChange({ formatNo: e.target.value })} error={errors.formatNo} />
          <TextInput label="Common format no." placeholder="e.g. F-123456" hint="Same for all plants" value={header.commonFormatNo} onChange={(e) => onChange({ commonFormatNo: e.target.value })} error={errors.commonFormatNo} />
          <TextInput label="Reference standard" value={header.refStandard} onChange={(e) => onChange({ refStandard: e.target.value })} error={errors.refStandard} />
          <TextInput label="Remarks for the approver" placeholder="Enter remarks…" value={header.remarks} onChange={(e) => onChange({ remarks: e.target.value })} error={errors.remarks} />
        </div>
      )}
    </section>
  );
}

function Starters({ onPick }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1"><LayoutTemplate className="w-5 h-5 text-blue-600" /><h2 className="text-base font-bold text-slate-900">Start your inspection report</h2></div>
      <p className="text-sm text-slate-500 mb-4">Pick a starting layout and change anything, or add fields from the palette to build it from scratch.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {STARTERS.map((st) => (
          <button key={st.key} type="button" onClick={() => onPick(st)} className="rounded-xl border border-slate-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer">
            <span className="block text-sm font-semibold text-slate-900">{st.title}</span>
            <span className="block text-xs text-slate-500 mt-0.5">{st.help}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const NUMBER_TONE = { RECORD: 'bg-slate-600', DIMENSIONAL: 'bg-blue-600', VISUAL: 'bg-emerald-600', RELIABILITY: 'bg-amber-500' };
const CARD_TINT = { RECORD: 'bg-slate-50/60', DIMENSIONAL: 'bg-blue-50/40', VISUAL: 'bg-emerald-50/40', RELIABILITY: 'bg-amber-50/40' };
const ADD_BUTTONS = {
  DIMENSIONAL: [['MEASURE', 'Add measurement']],
  VISUAL: [['OK_NOK', 'Add visual check'], ['CHOICE', 'Add multiple choice']],
  RELIABILITY: [['LOT_TEST', 'Add reliability check']],
  RECORD: [['TEXT', 'Text'], ['NUMBER', 'Number'], ['DATE', 'Date'], ['YES_NO', 'Yes / No'], ['CHOICE', 'Dropdown']],
};

function SectionCard({ n, s, fields, selected, errorsByKey, view, onView, collapsed, onCollapse, canUp, canDown, onSelect, onRename, onMove, onRemove, onDuplicateSection, onPaste, onAdd, onField, onMoveField, onDuplicate, onRemoveField, onDrop }) {
  const [over, setOver] = useState(false);
  const on = selected?.type === 'section' && selected.id === s.id;
  return (
    <section className={`card overflow-hidden ${on ? 'ring-2 ring-blue-400' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(`qmas/${s.kind.toLowerCase()}`)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const key = e.dataTransfer.getData('text/plain'); if (key) onDrop(key, s.id); }}>
      <div className={`flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 ${CARD_TINT[s.kind]}`}>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${NUMBER_TONE[s.kind]}`}>{n}</span>
        <div className="min-w-[14rem] flex-1">
          <div className="flex items-center gap-1 text-sm font-bold text-slate-900">
            <span className="shrink-0">Section {n}:</span>
            <input value={s.label} placeholder={SECTION_LABELS[s.kind]} onChange={(e) => onRename(e.target.value)} onFocus={() => onSelect({ type: 'section', id: s.id })} aria-label={`Section ${n} name`}
              className="min-w-0 flex-1 bg-transparent font-bold text-slate-900 placeholder:text-current rounded px-1 py-0.5 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <p className="truncate text-xs text-slate-500">{SECTION_SUB[s.kind]} · {fields.length} field{fields.length === 1 ? '' : 's'}</p>
        </div>
        <div role="radiogroup" aria-label="View" className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
          {[['table', 'Table view', Table2], ['list', 'List view', List]].map(([k, l, I]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => onView(k)} title={l}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 cursor-pointer ${view === k ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-500 hover:text-slate-800'}`}>
              <I className="h-3.5 w-3.5" /><span className="hidden sm:inline">{l}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center">
          <IconBtn label={collapsed ? 'Expand section' : 'Collapse section'} icon={collapsed ? ChevronDown : ChevronUp} onClick={onCollapse} />
          <IconBtn label="Move section up" icon={ArrowUp} onClick={() => onMove(-1)} disabled={!canUp} />
          <IconBtn label="Move section down" icon={ArrowDown} onClick={() => onMove(1)} disabled={!canDown} />
          <IconBtn label="Section settings" icon={Settings2} onClick={() => onSelect({ type: 'section', id: s.id })} />
          <IconBtn label="Duplicate section" icon={Copy} onClick={onDuplicateSection} />
          <IconBtn label="Delete section" icon={Trash2} tone="danger" onClick={onRemove} />
        </div>
      </div>
      {!collapsed && (
        <>
          {view === 'table' ? (
            <SectionTable kind={s.kind} sectionId={s.id} fields={fields} selected={selected} errorsByKey={errorsByKey} over={over}
              onSelect={onSelect} onField={onField} onDuplicate={onDuplicate} onRemoveField={onRemoveField} onDrop={onDrop} />
          ) : (
            <ul className={`divide-y divide-slate-100 ${over ? 'bg-blue-50/40' : ''}`}>
              {fields.map((f, i) => (
                <FieldRow key={f.key} f={f} n={i + 1} last={i === fields.length - 1} kind={s.kind} sectionId={s.id} selected={selected?.type === 'field' && selected.id === f.key} errors={errorsByKey[f.key]}
                  onSelect={() => onSelect({ type: 'field', id: f.key })} onChange={(patch) => onField(f.key, patch)} onMove={(d) => onMoveField(f.key, d)}
                  onDuplicate={() => onDuplicate(f.key)} onRemove={() => onRemoveField(f.key)} onDrop={onDrop} />
              ))}
              {!fields.length && <li className="px-4 py-5 text-center text-sm text-slate-400">Empty section. Add a field below or drag one here.</li>}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-slate-100 bg-white">
            {ADD_BUTTONS[s.kind].map(([t, l]) => (
              <button key={t} type="button" onClick={() => onAdd(t)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/60 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer">
                <Plus className="w-3.5 h-3.5" />{l}
              </button>
            ))}
            {s.kind === 'DIMENSIONAL' && (
              <button type="button" onClick={onPaste} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 cursor-pointer">
                <ClipboardPaste className="w-3.5 h-3.5" />Paste from Excel
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const cellCls = (err) => `h-8 w-full min-w-0 rounded-md border px-2 text-xs ${err ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'} focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400`;
const TH = ({ children, className = '', ...rest }) => <th {...rest} className={`px-1.5 py-2 text-left text-[11px] font-semibold text-slate-600 ${className}`}>{children}</th>;

/**
 * The section as an editable table, one row per field (the mockup's "table view"). Columns follow
 * the section kind; sample readings and OK / NOK are a preview of the inspection sheet.
 */
function SectionTable({ kind, sectionId, fields, selected, errorsByKey, over, onSelect, onField, onDuplicate, onRemoveField, onDrop }) {
  const [dragKey, setDragKey] = useState(null);
  const samples = [1, 2, 3];
  const heads = {
    DIMENSIONAL: (
      <>
        <tr className="bg-slate-50">
          <TH rowSpan={2} className="w-8" /><TH rowSpan={2} className="w-6">#</TH><TH rowSpan={2} className="min-w-32">Check point</TH><TH rowSpan={2} className="min-w-28">Specification</TH>
          <TH colSpan={2} className="text-center border-b border-slate-200">Tolerance</TH><TH rowSpan={2} className="w-20">UOM</TH><TH rowSpan={2} className="min-w-24">Instrument / method</TH>
          <TH colSpan={3} className="text-center border-b border-slate-200 bg-emerald-50/60">Sample readings <span className="font-normal text-slate-400">(preview)</span></TH>
          <TH rowSpan={2} className="w-16 text-center">OK / NOK</TH><TH rowSpan={2} className="w-16" />
        </tr>
        <tr className="bg-slate-50"><TH className="w-20">LSL</TH><TH className="w-20">USL</TH>{samples.map((x) => <TH key={x} className="w-14 text-center bg-emerald-50/60">X{x}</TH>)}</tr>
      </>
    ),
    VISUAL: <tr className="bg-slate-50"><TH className="w-8" /><TH className="w-6">#</TH><TH className="min-w-40">Check point</TH><TH className="min-w-48">Specification / criteria</TH><TH className="w-40">OK / NOK options</TH><TH className="min-w-40">Help for the inspector</TH><TH className="w-16" /></tr>,
    RELIABILITY: <tr className="bg-slate-50"><TH className="w-8" /><TH className="w-6">#</TH><TH className="min-w-40">Check point</TH><TH className="min-w-36">Specification</TH><TH className="w-36">Frequency</TH><TH className="min-w-32">Instrument / method</TH><TH className="w-20">UOM</TH><TH className="w-24 text-center">OK / NOK</TH><TH className="w-16" /></tr>,
    RECORD: <tr className="bg-slate-50"><TH className="w-8" /><TH className="w-6">#</TH><TH className="min-w-40">Label</TH><TH className="w-32">Field type</TH><TH className="min-w-48">Instructions / limits / options</TH><TH className="w-20 text-center">Required</TH><TH className="w-16" /></tr>,
  };
  const colCount = { DIMENSIONAL: 13, VISUAL: 7, RELIABILITY: 9, RECORD: 7 }[kind];
  const num = (v) => v.replace(/[^\d.-]/g, '');

  return (
    <div className={`overflow-x-auto ${over ? 'bg-blue-50/40' : ''}`}>
      <table className="w-full text-sm">
        <thead>{heads[kind]}</thead>
        <tbody>
          {fields.map((f, i) => {
            const e = errorsByKey[f.key] ?? {};
            const firstErr = Object.values(e)[0];
            const sel = selected?.type === 'field' && selected.id === f.key;
            const set = (patch) => onField(f.key, patch);
            const pick = () => onSelect({ type: 'field', id: f.key });
            const inp = (key, { w = '', numeric, label, ...props } = {}) => (
              <input value={f[key]} onFocus={pick} aria-label={`Row ${i + 1} ${label ?? key}`} aria-invalid={!!e[key]} {...props}
                onChange={(ev) => set({ [key]: numeric ? num(ev.target.value) : ev.target.value })} className={`${cellCls(e[key])} ${w} ${numeric ? 'text-right tabular' : ''}`} />
            );
            return [
              <tr key={f.key} draggable onClick={pick}
                onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', f.key); ev.dataTransfer.setData(`qmas/${kind.toLowerCase()}`, '1'); ev.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(ev) => { if (ev.dataTransfer.types.includes(`qmas/${kind.toLowerCase()}`)) { ev.preventDefault(); ev.stopPropagation(); setDragKey(f.key); } }}
                onDragLeave={() => setDragKey(null)}
                onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); setDragKey(null); const key = ev.dataTransfer.getData('text/plain'); if (key) onDrop(key, sectionId, f.key); }}
                className={`group border-t border-slate-100 align-middle ${sel ? 'bg-blue-50/70' : 'hover:bg-slate-50/70'} ${dragKey === f.key ? 'border-t-2 border-t-blue-500' : ''} ${firstErr ? 'shadow-[inset_3px_0_0_#f43f5e]' : ''}`}>
                <td className="px-1.5 py-1.5"><GripVertical className="h-4 w-4 cursor-grab text-slate-300" aria-hidden="true" /></td>
                <td className="px-1 py-1.5 text-xs tabular text-slate-500">{i + 1}</td>
                {kind === 'DIMENSIONAL' && (
                  <>
                    <td className="px-1 py-1.5">{inp('checkpoint', { label: 'check point', placeholder: 'e.g. Length', w: 'min-w-32' })}</td>
                    <td className="px-1 py-1.5">{inp('specification', {
                      label: 'specification', placeholder: 'e.g. 57 ± 0.3', w: 'min-w-28',
                      onBlur: () => { const p = parseSpec(f.specification); if (p && f.lsl === '' && f.usl === '') set({ nominal: p.nominal === null ? f.nominal : String(p.nominal), lsl: p.lsl === null ? '' : String(p.lsl), usl: p.usl === null ? '' : String(p.usl) }); },
                    })}</td>
                    <td className="px-1 py-1.5">{inp('lsl', { label: 'LSL', numeric: true, inputMode: 'decimal', placeholder: 'LSL', w: 'min-w-[4.5rem]' })}</td>
                    <td className="px-1 py-1.5">{inp('usl', { label: 'USL', numeric: true, inputMode: 'decimal', placeholder: 'USL', w: 'min-w-[4.5rem]' })}</td>
                    <td className="px-1 py-1.5">{inp('uom', { label: 'unit', list: 'builder-units', placeholder: 'mm', w: 'min-w-14' })}</td>
                    <td className="px-1 py-1.5">{inp('instrument', { label: 'instrument', list: 'builder-instruments', placeholder: 'e.g. DVC', w: 'min-w-24' })}</td>
                    {samples.map((x) => <td key={x} className="px-1 py-1.5 bg-emerald-50/30"><input disabled placeholder={`X${x}`} aria-label={`Sample X${x} (filled during inspection)`} className={`${cellCls(false)} w-12 text-center disabled:bg-white/60 disabled:text-slate-300`} /></td>)}
                    <td className="px-1 py-1.5 text-center"><span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" title="Worked out from the readings">auto</span></td>
                  </>
                )}
                {kind === 'VISUAL' && (
                  <>
                    <td className="px-1 py-1.5">{inp('checkpoint', { label: 'check point', placeholder: 'e.g. Colour of printing', w: 'min-w-36' })}</td>
                    <td className="px-1 py-1.5">{inp('specification', { label: 'specification', placeholder: 'What the inspector checks for', w: 'min-w-40' })}</td>
                    <td className="px-1 py-1.5">
                      <select value={f.inputType} onFocus={pick} onChange={(ev) => set(typePatch(f, ev.target.value))} aria-label={`Row ${i + 1} options`} className={`${cellCls(e.inputType)} min-w-32 cursor-pointer`}>
                        <option value="OK_NOK">OK / Not OK</option>
                        <option value="CHOICE">Multiple choice</option>
                      </select>
                      {f.inputType === 'CHOICE' && <span className="mt-0.5 block truncate text-[10px] text-violet-700" title={ruleText(f)}>{(f.options ?? []).map((o) => o.label).join(' · ')}</span>}
                    </td>
                    <td className="px-1 py-1.5">{inp('helpText', { label: 'help', placeholder: 'Optional', w: 'min-w-32' })}</td>
                  </>
                )}
                {kind === 'RELIABILITY' && (
                  <>
                    <td className="px-1 py-1.5">{inp('checkpoint', { label: 'check point', placeholder: 'e.g. Bursting strength', w: 'min-w-36' })}</td>
                    <td className="px-1 py-1.5">{inp('specification', { label: 'specification', placeholder: 'e.g. Min 14', w: 'min-w-28' })}</td>
                    <td className="px-1 py-1.5">
                      <select value={f.frequencyMonths} onFocus={pick} onChange={(ev) => set({ frequencyMonths: ev.target.value })} aria-label={`Row ${i + 1} frequency`} className={`${cellCls(e.frequencyMonths)} min-w-32 cursor-pointer`}>
                        {FREQUENCIES.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                        {!FREQUENCIES.some(([val]) => val === f.frequencyMonths) && <option value={f.frequencyMonths}>Every {f.frequencyMonths} months</option>}
                      </select>
                    </td>
                    <td className="px-1 py-1.5">{inp('instrument', { label: 'instrument', list: 'builder-instruments', placeholder: 'e.g. Lot test', w: 'min-w-28' })}</td>
                    <td className="px-1 py-1.5">{inp('uom', { label: 'unit', list: 'builder-units', w: 'min-w-14' })}</td>
                    <td className="px-1 py-1.5 text-center"><span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">OK / Not OK</span></td>
                  </>
                )}
                {kind === 'RECORD' && (
                  <>
                    <td className="px-1 py-1.5">{inp('checkpoint', { label: 'label', placeholder: 'e.g. Batch no.', w: 'min-w-36' })}</td>
                    <td className="px-1 py-1.5">
                      <select value={f.inputType} onFocus={pick} onChange={(ev) => set(typePatch(f, ev.target.value))} aria-label={`Row ${i + 1} field type`} className={`${cellCls(e.inputType)} min-w-28 cursor-pointer`}>
                        {INPUT_TYPES.RECORD.map((t) => <option key={t} value={t}>{t === 'CHOICE' ? 'Dropdown' : INPUT_TYPE_LABELS[t]}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1.5">
                      {f.inputType === 'TEXT' ? inp('specification', { label: 'instructions', placeholder: 'Optional instructions', w: 'min-w-40' })
                        : f.inputType === 'NUMBER' ? (
                          <div className="grid grid-cols-3 gap-1">
                            {inp('lsl', { label: 'min', numeric: true, placeholder: 'Min' })}
                            {inp('usl', { label: 'max', numeric: true, placeholder: 'Max' })}
                            {inp('uom', { label: 'unit', list: 'builder-units', placeholder: 'Unit' })}
                          </div>
                        ) : <span className="block truncate text-xs text-slate-500" title={ruleText(f)}>{f.inputType === 'DATE' ? 'A date' : ruleText(f) || 'Set the options in the panel →'}</span>}
                    </td>
                    <td className="px-1 py-1.5 text-center" onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" checked={f.isRequired} onChange={(ev) => set({ isRequired: ev.target.checked })} aria-label={`Row ${i + 1} required`} className="h-4 w-4 accent-blue-600 cursor-pointer" />
                    </td>
                  </>
                )}
                <td className="px-1 py-1.5" onClick={(ev) => ev.stopPropagation()}>
                  <div className="flex justify-end opacity-60 group-hover:opacity-100">
                    <IconBtn label="Duplicate" icon={Copy} onClick={() => onDuplicate(f.key)} />
                    <IconBtn label="Delete" icon={Trash2} tone="danger" onClick={() => onRemoveField(f.key)} />
                  </div>
                </td>
              </tr>,
              firstErr && (
                <tr key={`${f.key}-e`}><td /><td /><td colSpan={colCount - 2} className="px-1 pb-1.5 text-[11px] text-rose-600">{firstErr}</td></tr>
              ),
            ];
          })}
          {!fields.length && <tr><td colSpan={colCount} className="px-4 py-5 text-center text-sm text-slate-400">Empty section. Add a field below, or drag one here.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Measurements copied from Excel: one row per line, tab-separated. */
function PasteDialog({ onClose, onAdd }) {
  const [text, setText] = useState('');
  const rows = text.split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c.some(Boolean)).map(([checkpoint = '', specification = '', lsl = '', usl = '', uom = '', instrument = '']) => {
    const r = { checkpoint, specification, lsl: lsl.replace(/[^\d.-]/g, ''), usl: usl.replace(/[^\d.-]/g, ''), uom: uom || 'mm', instrument };
    const p = !r.lsl && !r.usl ? parseSpec(specification) : null;
    if (p) Object.assign(r, { nominal: p.nominal === null ? '' : String(p.nominal), lsl: p.lsl === null ? '' : String(p.lsl), usl: p.usl === null ? '' : String(p.usl) });
    return r;
  });
  return (
    <Modal title="Paste measurements from Excel" subtitle="Copy the rows in Excel (Ctrl+C) and paste them here (Ctrl+V)" size="lg" onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Plus} disabled={!rows.length} onClick={() => onAdd(rows)}>Add {rows.length || ''} measurement{rows.length === 1 ? '' : 's'}</Button>
        </>
      )}>
      <p className="mb-2 text-xs text-slate-600">Columns in this order: <b>Check point · Specification · LSL · USL · UOM · Instrument</b>. LSL and USL can be empty when the specification says it (e.g. <span className="font-mono">57 ± 0.3</span>).</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} autoFocus placeholder={'Length\t57 ± 0.3\t\t\tmm\tDVC\nWidth\t20\t19.8\t20.2\tmm\tDVC'}
        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
      {rows.length > 0 && (
        <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600"><tr>{['Check point', 'Specification', 'LSL', 'USL', 'UOM', 'Instrument'].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1">{r.checkpoint || <span className="text-rose-600">missing</span>}</td><td className="px-2 py-1">{r.specification}</td>
                  <td className="px-2 py-1 tabular">{r.lsl || '—'}</td><td className="px-2 py-1 tabular">{r.usl || '—'}</td><td className="px-2 py-1">{r.uom}</td><td className="px-2 py-1">{r.instrument}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
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

function PanelShell({ title, sub, onClose, onDelete, children }) {
  return (
    <section className="card">
      <div className="flex items-start gap-2 px-4 pt-3.5 pb-2 border-b border-slate-100">
        <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {sub && <p className="truncate text-[11px] text-slate-500">{sub}</p>}
        </div>
        {onDelete && <IconBtn label="Delete" icon={Trash2} tone="danger" onClick={onDelete} />}
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

function FieldProperties({ f, section, sections, errors, onChange, onClose, onDelete }) {
  const kindSections = sortSections(sections).filter((s) => s.kind === f.section);
  const limits = f.inputType === 'MEASURE' || f.inputType === 'NUMBER';
  const choice = f.inputType === 'CHOICE' || f.inputType === 'YES_NO';
  const setType = (t) => onChange(typePatch(f, t));
  const opts = f.options ?? [];
  const setOpt = (i, patch) => onChange({ options: opts.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const spec = parseSpec(f.specification);

  return (
    <PanelShell title="Field settings" sub={`${f.checkpoint || 'New field'} · ${sectionTitle(section)} · ${INPUT_TYPE_LABELS[f.inputType]}`} onClose={onClose} onDelete={onDelete}>
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

function SectionProperties({ s, count, onRename, onClose, onDelete }) {
  return (
    <PanelShell title="Section settings" sub={`${sectionTitle(s)} · ${SECTION_LABELS[s.kind]} · ${count} field${count === 1 ? '' : 's'}`} onClose={onClose} onDelete={onDelete}>
      <Input label="Section name" hint="shown as the heading on the sheet" value={s.label} placeholder={SECTION_LABELS[s.kind]} onChange={(e) => onRename(e.target.value)} maxLength={60} />
      <p className="text-xs text-slate-500">{KIND_HELP[s.kind]}</p>
      <p className="text-xs text-slate-400">Fields can be dragged between sections of the same kind. A section without fields is not saved.</p>
    </PanelShell>
  );
}

/** The draft as the inspector will see it: the checkpoints it would save, with this editor's keys as ids. */
function InspectorPreview({ sections, fields }) {
  const { ordered, checkpoints } = toPayload(sections, fields);
  return <InspectorView checkpoints={checkpoints.map((c, i) => ({ ...c, uid: ordered[i].key }))} note="Inspector's view of this draft, exactly as on an IMIR. Try readings and ticks; nothing is saved." />;
}

function IconBtn({ label, icon: Icon, onClick, disabled, tone }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className={`p-1.5 rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${tone === 'danger' ? 'text-rose-400 hover:bg-rose-50' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
