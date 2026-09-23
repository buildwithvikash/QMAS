import { determineSample, PERMISSIONS, validateSamplingRows } from '@qmas/shared';
import { AlertTriangle, Calculator, Plus, Table2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useGetSamplingPlansQuery, useUpdateSamplingPlanMutation } from '../../api/mastersApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';

const toNum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const cell = 'w-full px-2 py-1.5 text-sm text-right tabular rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 disabled:bg-transparent disabled:border-transparent';

/**
 * The sampling table QA maintains: lot size range → sample size, with optional acceptance (Ac) and
 * rejection (Re) numbers. Without Ac/Re a single NOK rejects the lot. New IMIRs use the default plan;
 * IMIRs already open keep the sample size they were opened with.
 */
export default function SamplingTablePage() {
  const { can } = useAccess();
  const { data: plans, isLoading } = useGetSamplingPlansQuery();
  const [selectedId, setSelectedId] = useState(null);
  if (isLoading || !plans) return <Loader />;
  const plan = plans.find((p) => p.id === selectedId) ?? plans.find((p) => p.isDefault) ?? plans[0];

  return (
    <div>
      <PageHeader icon={Table2} title="Sampling Table" subtitle="Lot size → sample size from the Sampling Inspection Procedure" />
      <div className="p-5">
        {plans.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {plans.map((p) => (
              <button key={p.id} type="button" onClick={() => setSelectedId(p.id)}
                className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${p.id === plan.id ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                {p.name} {p.isDefault && '· default'}
              </button>
            ))}
          </div>
        )}
        {plan && <PlanEditor key={`${plan.id}-${plan.rowVersion}`} plan={plan} editable={can(PERMISSIONS.SAMPLING_MANAGE)} />}
      </div>
    </div>
  );
}

function PlanEditor({ plan, editable }) {
  const [rows, setRows] = useState(() => plan.rows.map((r) => ({ ...r })));
  const [save, { isLoading }] = useUpdateSamplingPlanMutation();
  const parsed = useMemo(
    () => rows.map((r) => ({ lotMin: toNum(r.lotMin), lotMax: toNum(r.lotMax), sampleSize: toNum(r.sampleSize), acceptNo: toNum(r.acceptNo), rejectNo: toNum(r.rejectNo) })),
    [rows],
  );
  const { errors, warnings } = validateSamplingRows(parsed);
  const dirty = JSON.stringify(parsed) !== JSON.stringify(plan.rows);

  const setCell = (i, key, value) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const addRow = () => {
    const last = parsed.at(-1);
    setRows((rs) => [...rs, { lotMin: last?.lotMax ? last.lotMax + 1 : 1, lotMax: '', sampleSize: '', acceptNo: '', rejectNo: '' }]);
  };

  const submit = async () => {
    try {
      await save({ id: plan.id, rows: parsed, rowVersion: plan.rowVersion }).unwrap();
      toast.success('Sampling table saved. New IMIRs use it from now on.');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              {plan.name} {plan.isDefault && <Badge variant="primary">Default</Badge>}
            </h2>
            <p className="text-xs text-slate-400">{plan.code} · last changed {formatDateTime(plan.updatedAt)}</p>
          </div>
          {editable && (
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setRows(plan.rows.map((r) => ({ ...r })))}>Undo changes</Button>
              <Button size="sm" disabled={!dirty || errors.length > 0} loading={isLoading} onClick={submit}>Save table</Button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                <th className="px-3 py-2.5 text-right">Lot from</th>
                <th className="px-3 py-2.5 text-right">Lot to</th>
                <th className="px-3 py-2.5 text-right">Sample size</th>
                <th className="px-3 py-2.5 text-right" title="Acceptance number: lot accepted with this many NOK samples or fewer">Ac</th>
                <th className="px-3 py-2.5 text-right" title="Rejection number: lot rejected with this many NOK samples or more">Re</th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  {['lotMin', 'lotMax', 'sampleSize', 'acceptNo', 'rejectNo'].map((k) => (
                    <td key={k} className="px-2 py-1.5">
                      <input
                        className={cell}
                        inputMode="numeric"
                        aria-label={`${k} row ${i + 1}`}
                        disabled={!editable}
                        placeholder={k === 'lotMax' ? 'no limit' : k === 'acceptNo' ? '0' : k === 'rejectNo' ? '1' : ''}
                        value={r[k] ?? ''}
                        onChange={(e) => setCell(i, k, e.target.value.replace(/[^\d]/g, ''))}
                      />
                    </td>
                  ))}
                  {editable && (
                    <td className="px-2">
                      <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-4 space-y-2 border-t border-slate-100">
          {editable && <Button variant="secondary" size="sm" icon={Plus} onClick={addRow}>Add lot range</Button>}
          {errors.map((e) => <p key={e} role="alert" className="text-xs text-rose-600">{e}</p>)}
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{w}</p>
          ))}
          <p className="text-[11px] text-slate-400">Empty Ac/Re means one NOK sample rejects the lot (Ac 0, Re 1). A lot smaller than the first range is inspected in full.</p>
        </div>
      </section>

      <SampleCalculator rows={parsed} valid={errors.length === 0} />
    </div>
  );
}

/** Try the table (including unsaved edits) for an inward quantity. */
function SampleCalculator({ rows, valid }) {
  const [qty, setQty] = useState('5000');
  const result = valid && qty ? determineSample(rows, qty) : null;
  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-5 h-fit">
      <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Calculator className="w-4 h-4 text-blue-600" />Check a lot</h2>
      <label className="block mt-3 text-[10px] font-semibold text-slate-500 uppercase tracking-widest" htmlFor="calc-qty">Inward quantity</label>
      <input id="calc-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))}
        className="mt-1 w-full px-3 py-2 text-lg tabular rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
      {qty && (
        result ? (
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-blue-50 p-3"><dt className="text-[10px] uppercase tracking-widest text-blue-500">Sample</dt><dd className="text-2xl font-bold text-blue-700 tabular">{result.sampleSize}</dd></div>
            <div className="rounded-lg bg-emerald-50 p-3"><dt className="text-[10px] uppercase tracking-widest text-emerald-600">Accept ≤</dt><dd className="text-2xl font-bold text-emerald-700 tabular">{result.acceptNo}</dd></div>
            <div className="rounded-lg bg-rose-50 p-3"><dt className="text-[10px] uppercase tracking-widest text-rose-500">Reject ≥</dt><dd className="text-2xl font-bold text-rose-700 tabular">{result.rejectNo}</dd></div>
            <p className="col-span-3 text-xs text-slate-500 mt-1">{result.basis === 'FULL_LOT' ? 'Lot smaller than the first range: inspect every unit.' : `Lot of ${result.lotSize} units.`}</p>
          </dl>
        ) : (
          <p className="mt-4 text-sm text-amber-700">{valid ? 'The table has no row for this quantity, so an IMIR could not be opened.' : 'Fix the table errors first.'}</p>
        )
      )}
    </aside>
  );
}
