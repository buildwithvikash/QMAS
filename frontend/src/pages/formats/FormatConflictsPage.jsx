import { SECTION_LABELS } from '@qmas/shared';
import {
  ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronsDownUp, ChevronsUpDown, Database, FileText, GitBranch, GitMerge, Info, Layers, Send, TriangleAlert, Zap,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useGetFormatVersionQuery, useResolveConflictsMutation } from '../../api/formatsApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';
import { fieldLabel, fmtValue, SOURCE } from './formatHelpers.js';

const NUMERIC = new Set(['nominal', 'lsl', 'usl', 'frequencyMonths']);
// How much a field matters for inspection results: limits and structure decide OK / Not OK.
const IMPACT = {
  lsl: 'High', usl: 'High', nominal: 'Medium', inputType: 'High', options: 'High', section: 'High', _presence: 'High', isRequired: 'Medium',
  specification: 'Medium', frequencyMonths: 'Medium', uom: 'Medium', checkpoint: 'Low', instrument: 'Low', helpText: 'Low', groupLabel: 'Low',
  formatNo: 'Low', commonFormatNo: 'Low', refStandard: 'Low',
};
const IMPACT_TONE = { High: 'text-rose-600', Medium: 'text-amber-600', Low: 'text-slate-600' };
const dataType = (field, cp) => {
  if (field === '_presence') return 'Whole check point';
  if (NUMERIC.has(field)) return field === 'frequencyMonths' ? 'Number (months)' : `Numeric${cp?.uom ? ` (${cp.uom})` : ''}`;
  if (field === 'options') return 'Choice options';
  if (field === 'isRequired') return 'Yes / No';
  return 'Text';
};

function Summary({ icon: Icon, tone, value, label, note }) {
  const tones = { rose: ['bg-rose-50/70', 'bg-rose-100 text-rose-600'], blue: ['bg-blue-50/60', 'bg-blue-100 text-blue-600'], amber: ['bg-amber-50/70', 'bg-amber-100 text-amber-600'] }[tone];
  return (
    <div className={`flex items-center gap-4 rounded-xl px-4 py-3.5 ${tones[0]}`}>
      <span className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center ${tones[1]}`}><Icon className="w-6 h-6" /></span>
      <span>
        <span className="block text-2xl font-bold text-slate-900 tabular leading-tight">{value}</span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{note}</span>
      </span>
    </div>
  );
}

/**
 * Resolving a merge: for each field changed both in this draft and in the version approved since,
 * keep the approved value, keep the draft's, or enter another (with an optional reason). The draft
 * is then rebased and goes back to the approval queue.
 */
export default function FormatConflictsPage() {
  const { id } = useParams();
  const { data: v, isLoading, error } = useGetFormatVersionQuery(id, { refetchOnMountOrArgChange: true });
  const [choices, setChoices] = useState({});
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [resolve, { isLoading: saving }] = useResolveConflictsMutation();
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();

  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  if (v.status !== 'CONFLICT' || !v.allowedActions.includes('resolve')) return <Navigate to={`/formats/versions/${id}`} replace />;

  const set = (cid, patch) => setChoices((c) => ({ ...c, [cid]: { ...c[cid], ...patch } }));
  const isDone = (c) => { const ch = choices[c.id]; return !!ch?.choice && (ch.choice !== 'CUSTOM' || (ch.value ?? '') !== ''); };
  const done = v.conflicts.filter(isDone).length;
  const total = v.conflicts.length;
  const against = v.mergeInfo?.against;
  const cpOf = (c) => v.checkpoints.find((x) => x.uid === c.checkpointUid);
  const toggle = (cid) => setCollapsed((s) => { const n = new Set(s); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });

  const submit = async () => {
    setFormError('');
    const resolutions = v.conflicts.map((c) => {
      const ch = choices[c.id] ?? {};
      let value = ch.value;
      if (ch.choice === 'CUSTOM' && NUMERIC.has(c.field)) value = value === '' ? null : Number(value);
      return { conflictId: c.id, choice: ch.choice, ...(ch.choice === 'CUSTOM' ? { value, remark: ch.remark || undefined } : {}) };
    });
    try {
      const res = await resolve({ id, resolutions, rowVersion: v.rowVersion }).unwrap();
      if (res.outcome.result === 'RECOMPUTED') {
        toast.error('Another version was approved meanwhile. Review the updated conflicts.');
        setChoices({});
        return;
      }
      toast.success('Conflicts resolved. The format is back in the approval queue.');
      navigate(`/formats/versions/${id}`);
    } catch (err) {
      setFormError(apiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader icon={GitMerge} title={`Resolve conflicts - ${v.itemCode}`}
        subtitle={`This draft (started from v${v.baseVersionNo}) and the version approved since changed the same fields. Review the differences and choose the value for each field.`}>
        <Link to={`/formats/versions/${id}`} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="w-3.5 h-3.5" />Back</Link>
        <Button size="sm" icon={Check} disabled={done < total} loading={saving} onClick={submit}>Apply {done}/{total}</Button>
      </PageHeader>

      <div className="p-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] items-start">
        <div className="space-y-4 min-w-0">
          <section className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.8fr)] items-center">
            <Summary icon={GitMerge} tone="rose" value={total} label={`Field${total === 1 ? '' : 's'} with conflicts`} note="Needs your decision" />
            <Summary icon={CheckCircle2} tone="blue" value={v.mergeInfo?.autoResolved ?? 0} label="Auto resolved" note="Merge by themselves, no action required" />
            <Summary icon={FileText} tone="amber" value={total - done} label="Remaining" note="To be decided" />
            <div className="px-2">
              <p className="text-xs text-slate-500">Progress</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${(done / total) * 100}%` }} /></div>
                <span className="text-sm font-bold text-slate-900 tabular">{done} / {total}</span>
              </div>
              <p className="mt-1 text-right text-[11px] text-slate-500">fields chosen</p>
            </div>
          </section>

          <FormError message={formError} />

          <section className="card">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
              <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center"><Layers className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-slate-900">Conflicting Fields ({total})</h2>
                <p className="text-xs text-slate-500">Choose the correct value for each field. After applying, the draft goes back to the approval queue.</p>
              </div>
              <button type="button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(v.conflicts.map((c) => c.id)))}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                {collapsed.size ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}{collapsed.size ? 'Expand all' : 'Collapse all'}
              </button>
            </div>

            <div className="p-4 space-y-4">
              {v.conflicts.map((c, i) => {
                const ch = choices[c.id] ?? {};
                const cp = cpOf(c);
                const presence = c.field === '_presence';
                const open = !collapsed.has(c.id);
                const chosen = isDone(c);
                const impact = IMPACT[c.field] ?? 'Medium';
                const where = cp ? (cp.groupLabel || SECTION_LABELS[cp.section]) : 'Format header';
                const opt = (choice, title, pill, pillTone, value, on, by, card) => (
                  <label className={`rounded-xl border-2 p-4 cursor-pointer transition-colors ${ch.choice === choice ? card : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name={`c-${c.id}`} className="w-4 h-4 accent-blue-600" checked={ch.choice === choice} onChange={() => set(c.id, { choice })} />
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-700">{title}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${pillTone}`}>{pill}</span>
                    </span>
                    <span className="block mt-3 ml-6 text-2xl font-bold text-slate-900 font-mono break-words">{fmtValue(c.field, value)}</span>
                    <span className="block mt-3 ml-6 border-t border-slate-200/70 pt-2 text-xs text-slate-500">Updated on <b className="block text-sm font-semibold text-slate-800">{formatDateTime(on)}</b></span>
                    <span className="block mt-1.5 ml-6 text-xs text-slate-500">Updated by <b className="block text-sm font-semibold text-slate-800">{by ?? '—'}</b></span>
                  </label>
                );
                return (
                  <article key={c.id} className={`rounded-xl border ${chosen ? 'border-emerald-200' : 'border-slate-200'}`}>
                    <button type="button" onClick={() => toggle(c.id)} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer">
                      <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white ${chosen ? 'bg-emerald-600' : 'bg-rose-500'}`}>{chosen ? <Check className="w-4 h-4" /> : i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-bold text-slate-900">{c.label ?? 'Format header'}</span>
                        <span className="block text-xs text-slate-500">{presence ? 'Kept on one side, removed on the other' : fieldLabel(c.field)}</span>
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${chosen ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{chosen ? 'Decided' : presence ? 'Kept vs removed' : 'Value changed'}</span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="px-4 pb-4 space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {[
                            [Database, 'Data type', dataType(c.field, cp)],
                            [GitBranch, `Before both changes (v${v.baseVersionNo})`, presence ? 'Present' : fmtValue(c.field, c.baseValue)],
                            [Layers, 'Used in', where],
                            [Zap, 'Impact', <span key="i" className={`font-bold ${IMPACT_TONE[impact]}`}>{impact}</span>],
                          ].map(([Icon, k, val]) => (
                            <div key={k} className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
                              <Icon className="w-4 h-4 shrink-0 text-blue-600" />
                              <span className="min-w-0"><span className="block text-[11px] text-slate-500">{k}</span><span className="block text-sm font-semibold text-slate-900 truncate">{val}</span></span>
                            </div>
                          ))}
                        </div>
                        <div role="radiogroup" className={`grid gap-3 ${presence ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                          {opt('THEIRS', `Approved version${against ? ` (v${against.versionNo})` : ''}`, 'Current', 'bg-emerald-100 text-emerald-700', c.theirsValue, against?.decidedAt, against?.decidedByName, 'border-emerald-400 bg-emerald-50/60')}
                          {opt('MINE', `This draft (from v${v.baseVersionNo})`, 'Proposed', 'bg-blue-100 text-blue-700', c.mineValue, v.updatedAt, v.createdByName, 'border-blue-400 bg-blue-50/60')}
                          {!presence && (
                            <label className={`rounded-xl border-2 p-4 cursor-pointer transition-colors ${ch.choice === 'CUSTOM' ? 'border-violet-400 bg-violet-50/50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                              <span className="flex items-center gap-2">
                                <input type="radio" name={`c-${c.id}`} className="w-4 h-4 accent-blue-600" checked={ch.choice === 'CUSTOM'} onChange={() => set(c.id, { choice: 'CUSTOM' })} />
                                <span className="text-xs font-bold uppercase tracking-wide text-slate-700">Other value</span>
                              </span>
                              <input aria-label="Other value" inputMode={NUMERIC.has(c.field) ? 'decimal' : undefined} value={ch.value ?? ''} placeholder="Enter value"
                                onFocus={() => set(c.id, { choice: 'CUSTOM' })} onChange={(e) => set(c.id, { choice: 'CUSTOM', value: NUMERIC.has(c.field) ? e.target.value.replace(/[^\d.-]/g, '') : e.target.value })}
                                className="mt-3 w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
                              {NUMERIC.has(c.field) && <span className="block mt-1 text-[11px] text-slate-500">e.g. a value between {fmtValue(c.field, c.theirsValue)} and {fmtValue(c.field, c.mineValue)}{cp?.uom ? ` ${cp.uom}` : ''}</span>}
                              <span className="block mt-3 text-xs text-slate-600">Remark (optional)</span>
                              <textarea rows={2} value={ch.remark ?? ''} maxLength={300} onFocus={() => set(c.id, { choice: 'CUSTOM' })} onChange={(e) => set(c.id, { remark: e.target.value })} placeholder="Add reason for this value…"
                                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
                            </label>
                          )}
                        </div>
                        {cp && (
                          <div className="flex gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                            <Info className="w-5 h-5 shrink-0 text-blue-600" />
                            <div className="text-xs text-slate-600">
                              <p className="text-sm font-semibold text-blue-800">Field description / guideline</p>
                              <p>{cp.checkpoint} · {where}{cp.specification ? ` · Specification ${cp.specification}` : ''}{cp.uom ? ` · Unit: ${cp.uom}` : ''}{cp.instrument ? ` · ${cp.instrument}` : ''}</p>
                              {cp.helpText && <p>{cp.helpText}</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-[calc(var(--page-header-h,0px)+1.25rem)]">
          <section className="card">
            <h3 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-sm font-bold text-slate-900"><FileText className="w-4 h-4 text-blue-600" />Format Details</h3>
            <dl className="px-4 pb-4 space-y-1.5 text-sm">
              {[
                ['Format No.', v.formatNo], ['Common Format No.', v.commonFormatNo], ['Item Code', v.itemCode], ['Item Description', v.itemDescription],
                ['Item Category', v.itemCategory], ['Standard', v.refStandard], ['Current Version', against ? `v${against.versionNo}` : '—'], ['Source', SOURCE[v.source]],
              ].map(([k, val]) => (
                <div key={k} className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-900 break-words">{val ?? '—'}</dd></div>
              ))}
            </dl>
          </section>
          <section className="card">
            <h3 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-sm font-bold text-slate-900"><GitBranch className="w-4 h-4 text-blue-600" />Version Comparison</h3>
            <ol className="px-4 pb-4 space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-blue-600" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-800">Draft version <span className="ml-1 rounded bg-blue-50 px-1.5 text-xs text-blue-700">from v{v.baseVersionNo}</span></span>
                  <span className="block text-xs text-slate-500">{formatDateTime(v.createdAt)} · {v.createdByName}</span>
                </span>
              </li>
              {against && (
                <li className="flex gap-3">
                  <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-emerald-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-800">Approved version <span className="ml-1 rounded bg-emerald-50 px-1.5 text-xs text-emerald-700">v{against.versionNo}</span></span>
                    <span className="block text-xs text-slate-500">{formatDateTime(against.decidedAt)} · {against.decidedByName ?? '—'}</span>
                  </span>
                </li>
              )}
            </ol>
          </section>
          <section className="flex gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
            <Send className="w-5 h-5 shrink-0 text-blue-600" />
            <div className="text-xs text-slate-600">
              <p className="text-sm font-semibold text-blue-800">After resolving</p>
              Once every conflicting field has a value, applying rebases the draft onto v{against?.versionNo ?? '—'} and sends it back to the approval queue.
            </div>
          </section>
          {total - done > 0 && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-amber-700"><TriangleAlert className="w-3.5 h-3.5" />{total - done} field{total - done === 1 ? '' : 's'} still to decide.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
