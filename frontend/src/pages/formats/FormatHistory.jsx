import { SECTION_LABELS } from '@qmas/shared';
import {
  AlertTriangle, CheckCircle2, ExternalLink, Eye, EyeOff, FilePlus2, FileText, FileUp, GitMerge, History, PencilLine, Send, Trash2, UserRound, Undo2, Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DateRange, FilterSelect } from '../../components/ui/ListFilters.jsx';
import { formatDate } from '../../utils/format.js';
import { fieldLabel, fmtValue, SOURCE } from './formatHelpers.js';
import { TypeChip } from './formatUi.jsx';

/**
 * Version history of a format: every step (draft started, saved, submitted, returned, approved or
 * merged, conflicts, discarded, imported), newest first, as a timeline. "View details" opens what
 * the step changed field by field, its remark and where it came from.
 * `events` from /formats/items/:id/history or /formats/versions/:id/history.
 */

// Icon, icon circle, card tint, status pill (label + colours) per step.
const LOOK = {
  CREATED: [FilePlus2, 'bg-violet-100 text-violet-700', '', ['Draft', 'bg-violet-50 text-violet-700']],
  SAVED: [PencilLine, 'bg-slate-100 text-slate-600', '', ['Saved', 'bg-slate-100 text-slate-600']],
  SUBMITTED: [Send, 'bg-sky-100 text-sky-700', '', ['Submitted', 'bg-sky-50 text-sky-700']],
  RETURNED: [Undo2, 'bg-amber-100 text-amber-700', 'bg-amber-50/40', ['Returned', 'bg-amber-50 text-amber-800']],
  APPROVED: [CheckCircle2, 'bg-emerald-100 text-emerald-700', 'bg-emerald-50/50 border-emerald-200', ['Approved', 'bg-emerald-100 text-emerald-700']],
  MERGED: [GitMerge, 'bg-emerald-100 text-emerald-700', 'bg-emerald-50/50 border-emerald-200', ['Merged', 'bg-emerald-100 text-emerald-700']],
  CONFLICT: [AlertTriangle, 'bg-rose-100 text-rose-700', 'bg-rose-50/40', ['Conflict', 'bg-rose-50 text-rose-700']],
  RESOLVED: [Wrench, 'bg-violet-100 text-violet-700', '', ['Resolved', 'bg-violet-50 text-violet-700']],
  DISCARDED: [Trash2, 'bg-slate-100 text-slate-500', 'bg-slate-50/60', ['Discarded', 'bg-slate-100 text-slate-500']],
  IMPORTED: [FileUp, 'bg-indigo-100 text-indigo-700', '', ['Imported', 'bg-indigo-50 text-indigo-700']],
};
const STEP_OPTIONS = [
  { value: 'changes', label: 'Content changes' },
  { value: 'decisions', label: 'Approvals & returns' },
  { value: 'CREATED', label: 'Drafts started' },
  { value: 'SAVED', label: 'Saves' },
  { value: 'SUBMITTED', label: 'Submissions' },
  { value: 'APPROVED', label: 'Approvals' },
  { value: 'RETURNED', label: 'Returns' },
  { value: 'CONFLICT', label: 'Conflicts' },
  { value: 'DISCARDED', label: 'Discards' },
  { value: 'IMPORTED', label: 'Imports' },
];
const GROUPS = { changes: ['CREATED', 'SAVED', 'IMPORTED', 'RESOLVED'], decisions: ['SUBMITTED', 'APPROVED', 'MERGED', 'RETURNED', 'CONFLICT', 'DISCARDED'] };
const TIME = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const dayIst = (v) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(v));

const counts = (d) => [
  d?.added?.length && `${d.added.length} added`,
  d?.changed?.length && `${d.changed.length} changed`,
  d?.removed?.length && `${d.removed.length} removed`,
  d?.header?.length && `${d.header.length} header field${d.header.length > 1 ? 's' : ''}`,
  d?.moved && `${d.moved} reordered`,
].filter(Boolean).join(', ');

const ver = (e) => (e.versionNo ? `v${e.versionNo}` : 'the draft');

/** Title and one-line description of a step. */
function describe(e) {
  const d = e.detail ?? {};
  switch (e.action) {
    case 'CREATED': {
      const from = d.source === 'CURRENT' ? `from current version${d.baseVersionNo ? ` v${d.baseVersionNo}` : ''}` : d.source === 'CUSTOM' ? 'in the format builder'
        : d.source === 'CLONE' ? `copied from ${d.sourceRef?.itemCode ?? 'another item'} v${d.sourceRef?.versionNo ?? ''}` : d.source === 'SAN' ? `from SAN/SIR${d.sourceRef?.vendorCode ? ` (vendor ${d.sourceRef.vendorCode})` : ''}` : 'as a blank format';
      return [`Draft started - ${from}`, `New draft created ${d.baseVersionNo ? `from existing version v${d.baseVersionNo}` : SOURCE[d.source]?.toLowerCase() ?? ''}${d.checkpoints ? ` with ${d.checkpoints} checkpoints` : ''}.`];
    }
    case 'SAVED': return ['Draft saved', counts(d) ? `Changes saved: ${counts(d)}.` : 'Saved without content changes.'];
    case 'SUBMITTED': return ['Submitted for approval', `Draft version submitted for approval${d.checkpoints ? ` with ${d.checkpoints} checkpoints` : ''}.`];
    case 'RETURNED': return ['Returned for rework', 'Sent back to the preparer to change and submit again.'];
    case 'APPROVED': return [`Approved as v${d.versionNo}`, `Format version v${d.versionNo} has been approved and published${d.changes && counts(d.changes) ? ` (${counts(d.changes)})` : ''}.`];
    case 'MERGED': return [`Merged and approved as v${d.versionNo}`, `Merged with the changes approved meanwhile and published as v${d.versionNo}.`];
    case 'CONFLICT': return [d.recomputed ? 'New merge conflicts' : 'Merge conflict', `${d.conflicts} field${d.conflicts === 1 ? ' was' : 's were'} changed here and in ${d.againstVersionNo ? `v${d.againstVersionNo}` : 'the approved version'}.`];
    case 'RESOLVED': return ['Conflicts resolved', `${d.choices?.length ?? 0} conflict${d.choices?.length === 1 ? '' : 's'} decided; back in the approval queue.`];
    case 'DISCARDED': return ['Draft discarded', 'The draft was closed without approval.'];
    case 'IMPORTED': return [`Imported as v${d.versionNo ?? 1}${d.checkpoints ? ` - ${d.checkpoints} checkpoints` : ''}`, `Format imported${d.checkpoints ? ` with ${d.checkpoints} checkpoints` : ''} and approved as version ${d.versionNo ?? 1}.`];
    default: return [e.action, ''];
  }
}

/** The field-level changes of a save or an approval. */
function ChangeList({ d }) {
  const where = (c) => c.groupLabel || SECTION_LABELS[c.section] || '';
  return (
    <div className="grid gap-3 sm:grid-cols-3 text-xs">
      {d.added?.length > 0 && (
        <div>
          <p className="font-semibold text-emerald-700 mb-1">Added ({d.added.length})</p>
          <ul className="space-y-1">{d.added.map((c) => <li key={c.uid} className="flex flex-wrap items-center gap-1.5 text-slate-700"><span className="font-medium">{c.checkpoint}</span>{c.inputType && <TypeChip type={c.inputType} />}<span className="text-slate-400">{where(c)}</span></li>)}</ul>
        </div>
      )}
      {d.changed?.length > 0 && (
        <div>
          <p className="font-semibold text-amber-700 mb-1">Changed ({d.changed.length})</p>
          <ul className="space-y-1.5">
            {d.changed.map((c) => (
              <li key={c.uid}>
                <span className="font-medium text-slate-800">{c.checkpoint}</span>
                {c.fields.map((f) => <span key={f.field} className="block text-slate-600">{fieldLabel(f.field)}: <s className="text-rose-500">{fmtValue(f.field, f.from)}</s> → <b className="text-slate-800">{fmtValue(f.field, f.to)}</b></span>)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.removed?.length > 0 && (
        <div>
          <p className="font-semibold text-rose-700 mb-1">Removed ({d.removed.length})</p>
          <ul className="space-y-1">{d.removed.map((c) => <li key={c.uid} className="text-slate-500"><span className="line-through">{c.checkpoint}</span> · {where(c)}</li>)}</ul>
        </div>
      )}
      {d.header?.length > 0 && (
        <div className="sm:col-span-3">
          <p className="font-semibold text-slate-700 mb-1">Header</p>
          {d.header.map((h) => <p key={h.field} className="text-slate-600">{fieldLabel(h.field)}: <s className="text-rose-500">{fmtValue(h.field, h.from)}</s> → <b className="text-slate-800">{fmtValue(h.field, h.to)}</b></p>)}
        </div>
      )}
    </div>
  );
}

function Details({ e, showVersion }) {
  const d = e.detail ?? {};
  const changes = e.action === 'SAVED' ? d : d.changes;
  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-slate-200 bg-white p-3">
      {e.remark && <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">Remark: “{e.remark}”</p>}
      {d.note && <p className="text-xs text-slate-600">{d.note}</p>}
      {d.file && <p className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs text-blue-900"><FileText className="w-3.5 h-3.5" />Imported from {d.file}{d.sheet ? `, sheet ${d.sheet}` : ''}{d.rows ? `, rows ${d.rows[0]}–${d.rows[1]}` : ''}</p>}
      {e.action === 'CONFLICT' && d.fields?.length > 0 && <p className="text-xs text-rose-700">{d.fields.map((f) => `${f.checkpoint ?? 'Header'} (${fieldLabel(f.field)})`).join(', ')}</p>}
      {e.action === 'RESOLVED' && d.choices?.length > 0 && (
        <ul className="text-xs text-slate-600 space-y-0.5">{d.choices.map((c, i) => (
          <li key={i}>{c.checkpoint ?? 'Header'} · {fieldLabel(c.field)} → {c.choice === 'THEIRS' ? 'approved value' : c.choice === 'MINE' ? 'draft value' : 'own value'}{'value' in c ? <b className="text-slate-800"> {fmtValue(c.field, c.value)}</b> : null}{c.remark ? <span className="text-slate-500"> (“{c.remark}”)</span> : null}</li>
        ))}</ul>
      )}
      {changes && counts(changes) ? <ChangeList d={changes} /> : !e.remark && !d.note && !d.file && e.action !== 'CONFLICT' && e.action !== 'RESOLVED' && <p className="text-xs text-slate-500">No content changed in this step.</p>}
      {showVersion && e.versionId && (
        <Link to={`/formats/versions/${e.versionId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
          Open {ver(e)}{e.versionStatus ? ` (${e.versionStatus.toLowerCase().replace('_', ' ')})` : ''}<ExternalLink className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

export default function FormatHistory({ events, loading, showVersion = true, empty = 'No history yet.' }) {
  const [step, setStep] = useState(undefined);
  const [range, setRange] = useState({ from: undefined, to: undefined });
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const list = (events ?? []).filter((e) => {
    if (step && !(GROUPS[step] ?? [step, ...(step === 'APPROVED' ? ['MERGED'] : [])]).includes(e.action)) return false;
    const day = dayIst(e.at);
    return (!range.from || day >= range.from) && (!range.to || day <= range.to);
  });

  return (
    <section className="card">
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-slate-100">
        <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center"><History className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1 self-center">
          <h3 className="text-base font-bold text-slate-900">Version History</h3>
          <p className="text-xs text-slate-500">Complete timeline of version changes, approvals, drafts and imports.</p>
        </div>
        <FilterSelect label="Steps" value={step} onChange={setStep} options={STEP_OPTIONS} placeholder="All steps" width="w-44" />
        <DateRange label="Between" from={range.from} to={range.to} onChange={setRange} />
      </div>

      {loading ? <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}</div>
        : !list.length ? <p className="p-8 text-center text-sm text-slate-500">{events?.length ? 'No step matches these filters.' : empty}</p> : (
          <ol className="px-4 py-4">
            {list.map((e, i) => {
              const [Icon, circle, tint, [pill, pillTone]] = LOOK[e.action] ?? [History, 'bg-slate-100 text-slate-600', '', [e.action, 'bg-slate-100 text-slate-600']];
              const [title, text] = describe(e);
              const isOpen = open.has(e.id);
              return (
                <li key={e.id} className="grid grid-cols-[5.5rem_2.5rem_minmax(0,1fr)] gap-x-3">
                  <div className="pt-3 text-right">
                    <p className="text-xs font-medium text-slate-700 whitespace-nowrap">{formatDate(e.at)}</p>
                    <p className="text-xs text-slate-400 tabular">{TIME.format(new Date(e.at))}</p>
                  </div>
                  <div className="relative flex justify-center">
                    {i < list.length - 1 && <span className="absolute top-12 -bottom-0 w-0.5 bg-slate-200" aria-hidden="true" />}
                    <span className={`relative z-10 mt-2.5 w-9 h-9 rounded-full flex items-center justify-center ring-4 ring-white ${circle}`}><Icon className="w-4 h-4" /></span>
                  </div>
                  <div className={`mb-3 rounded-xl border border-slate-200 px-4 py-3 ${tint}`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{title}</span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${pillTone}`}>{pill}</span>
                        </p>
                        <p className="text-xs text-slate-500">{text}</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 min-w-40"><UserRound className="w-4 h-4 text-slate-400" />By <b className="font-semibold text-slate-800">{e.actorName ?? 'System'}</b></span>
                      {showVersion && (
                        <span className={`min-w-10 text-center rounded-md px-2 py-0.5 text-xs font-bold ${e.versionNo ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700'}`}>{e.versionNo ? `v${e.versionNo}` : 'draft'}</span>
                      )}
                      <button type="button" onClick={() => toggle(e.id)} aria-expanded={isOpen}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                        {isOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}{isOpen ? 'Hide details' : 'View Details'}
                      </button>
                    </div>
                    {isOpen && <Details e={e} showVersion={showVersion} />}
                    {!isOpen && e.detail?.file && <p className="mt-2 flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs text-blue-900"><FileText className="w-3.5 h-3.5" />Imported from {e.detail.file}</p>}
                    {!isOpen && e.remark && <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">“{e.remark}”</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
    </section>
  );
}
