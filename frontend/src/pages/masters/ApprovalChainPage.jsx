import { PERMISSIONS } from '@qmas/shared';
import { GitBranch } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetDeptChainsQuery, useUpdateDeptChainMutation } from '../../api/workflowApi.js';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';

const OPTIONS = [
  { levels: ['SUB_HEAD'], label: 'Initiator → Sub-Head', help: 'Sub-Head approval stands in for the Head (default).' },
  { levels: ['SUB_HEAD', 'HEAD'], label: 'Initiator → Sub-Head → Head', help: 'The Head approves after the Sub-Head.' },
  { levels: ['HEAD'], label: 'Initiator → Head', help: 'Only the Head approves.' },
];

/** Department approval chain for Deviation Forms (SCM and VD). Changes apply to forms submitted afterwards. */
export default function ApprovalChainPage() {
  const { data, isLoading } = useGetDeptChainsQuery();
  const [update, { isLoading: saving }] = useUpdateDeptChainMutation();
  const { can } = useAccess();
  const editable = can(PERMISSIONS.MASTERS_MANAGE);
  if (isLoading) return <Loader />;

  const choose = async (chain, levels) => {
    try {
      await update({ department: chain.department, levels, rowVersion: chain.rowVersion }).unwrap();
      toast.success(`${chain.department} approval chain updated`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader icon={GitBranch} title="Deviation Approval Chain" subtitle="Who approves a Deviation Form in SCM and VD before the IQC Head decides" />
      <div className="p-5 grid gap-4 lg:grid-cols-2">
        {data.map((chain) => (
          <section key={chain.department} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-800">{chain.department === 'SCM' ? 'Supply Chain (SCM)' : 'Vendor Development (VD)'}</h2>
            <p className="text-[11px] text-slate-400 mb-3">Last changed {formatDateTime(chain.updatedAt)}. Forms already in approval keep their chain.</p>
            <div className="space-y-2" role="radiogroup" aria-label={`${chain.department} approval chain`}>
              {OPTIONS.map((o) => {
                const active = o.levels.join() === chain.levels.join();
                return (
                  <button key={o.label} type="button" role="radio" aria-checked={active} disabled={!editable || saving || active} onClick={() => choose(chain, o.levels)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${active ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 cursor-pointer disabled:cursor-not-allowed disabled:hover:border-slate-200'}`}>
                    <div className={`text-sm font-semibold ${active ? 'text-blue-800' : 'text-slate-700'}`}>{o.label}</div>
                    <div className="text-xs text-slate-500">{o.help}</div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
