import { ArrowLeft, GitMerge } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useGetFormatVersionQuery, useResolveConflictsMutation } from '../../api/formatsApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { fieldLabel, fmtValue } from './formatHelpers.js';

const NUMERIC = new Set(['nominal', 'lsl', 'usl', 'frequencyMonths']);

/**
 * One card per clash: what it was (base), what was approved meanwhile, what this draft says.
 * The user keeps one side or types another value; the draft is then rebased and re-queued.
 */
export default function FormatConflictsPage() {
  const { id } = useParams();
  const { data: v, isLoading, error } = useGetFormatVersionQuery(id, { refetchOnMountOrArgChange: true });
  const [choices, setChoices] = useState({});
  const [resolve, { isLoading: saving }] = useResolveConflictsMutation();
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();

  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  if (v.status !== 'CONFLICT' || !v.allowedActions.includes('resolve')) return <Navigate to={`/formats/versions/${id}`} replace />;

  const set = (cid, patch) => setChoices((c) => ({ ...c, [cid]: { ...c[cid], ...patch } }));
  const done = v.conflicts.filter((c) => choices[c.id]?.choice && (choices[c.id].choice !== 'CUSTOM' || (choices[c.id].value ?? '') !== '')).length;

  const submit = async () => {
    setFormError('');
    const resolutions = v.conflicts.map((c) => {
      const ch = choices[c.id] ?? {};
      let value = ch.value;
      if (ch.choice === 'CUSTOM' && NUMERIC.has(c.field)) value = value === '' ? null : Number(value);
      return { conflictId: c.id, choice: ch.choice, ...(ch.choice === 'CUSTOM' ? { value } : {}) };
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
      <PageHeader icon={GitMerge} title={`Resolve conflicts · ${v.itemCode}`} subtitle={`This draft (started from v${v.baseVersionNo}) and the version approved since changed the same fields`}>
        <Link to={`/formats/versions/${id}`} className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />Back</Link>
        <Button size="sm" disabled={done < v.conflicts.length} loading={saving} onClick={submit}>Apply {done}/{v.conflicts.length}</Button>
      </PageHeader>
      <div className="p-5 space-y-4 max-w-4xl">
        <FormError message={formError} />
        {v.conflicts.map((c, i) => {
          const ch = choices[c.id] ?? {};
          const presence = c.field === '_presence';
          const options = presence
            ? [
                { choice: 'THEIRS', label: `Approved version: ${fmtValue('_presence', c.theirsValue)}` },
                { choice: 'MINE', label: `This draft: ${fmtValue('_presence', c.mineValue)}` },
              ]
            : [
                { choice: 'THEIRS', label: 'Approved version', value: c.theirsValue },
                { choice: 'MINE', label: 'This draft', value: c.mineValue },
                { choice: 'CUSTOM', label: 'Other value' },
              ];
          return (
            <fieldset key={c.id} className="card p-4">
              <legend className="px-1 text-sm font-bold text-slate-800">
                {i + 1}. {c.label ?? 'Header'} — {presence ? 'kept on one side, removed on the other' : fieldLabel(c.field)}
              </legend>
              {!presence && <p className="text-xs text-slate-500 mb-3">Before both changes: <b>{fmtValue(c.field, c.baseValue)}</b></p>}
              <div className="grid gap-2 sm:grid-cols-3">
                {options.map((o) => (
                  <label key={o.choice} className={`rounded-lg border p-3 cursor-pointer text-sm ${ch.choice === o.choice ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name={`c-${c.id}`} className="accent-blue-600" checked={ch.choice === o.choice} onChange={() => set(c.id, { choice: o.choice })} />
                      <span className="font-semibold text-slate-700">{o.label}</span>
                    </span>
                    {'value' in o && <span className="block mt-1 ml-6 font-mono text-slate-800">{fmtValue(c.field, o.value)}</span>}
                    {o.choice === 'CUSTOM' && ch.choice === 'CUSTOM' && (
                      <input autoFocus aria-label="Other value" inputMode={NUMERIC.has(c.field) ? 'decimal' : undefined} value={ch.value ?? ''}
                        onChange={(e) => set(c.id, { value: e.target.value })}
                        className="mt-2 ml-6 w-[calc(100%-1.5rem)] px-2 py-1.5 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
