import { History, Search, Undo2 } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useGetMyReversalsQuery, useWithdrawReversalMutation } from '../../api/reversalApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';
import { done } from '../../utils/notify.jsx';
import { HISTORY_LABELS } from '../deviation/historyFormat.js';
import { RequestDialog } from '../deviation/ReversalPanel.jsx';

const TYPE = { IMIR: 'IMIR', DEVIATION: 'Deviation', DN: 'DN / CAPA' };
const LINK = { IMIR: 'imirs', DEVIATION: 'deviations', DN: 'dns' };
const STATE = { PENDING: ['Waiting for admin', 'warning'], REVERSED: ['Reversed', 'success'], REJECTED: ['Not accepted', 'danger'], WITHDRAWN: ['Withdrawn', 'neutral'] };
const stepName = (a) => (a ? HISTORY_LABELS[a] ?? a : null);

/**
 * Help & Support → Reversal: ask an admin to reverse one of your own decisions (only while nobody
 * else has acted on the record since), and follow your requests.
 */
export default function ReversalHelpPage() {
  const { data, isLoading, error } = useGetMyReversalsQuery();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [withdraw, withdrawing] = useWithdrawReversalMutation();
  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;

  const needle = q.trim().toLowerCase();
  const candidates = data.candidates.filter((c) => !needle || `${c.recordNo} ${c.itemCode} ${c.itemDescription}`.toLowerCase().includes(needle));
  const take = (id) => withdraw(id).unwrap().then(() => done('Request withdrawn.'), (err) => toast.error(apiError(err).message));

  return (
    <div>
      <PageHeader icon={Undo2} title="Reversal" subtitle="Took a wrong decision? Ask an admin to reverse it. You can reverse only your own decisions, and only while nobody else has acted on the record since." />
      <div className="p-5 space-y-4">
        <section className="card">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <h2 className="section-title">Your decisions you can reverse</h2>
            <label className="relative ml-auto w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Record no. or item…" aria-label="Search your decisions"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
          </div>
          {candidates.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">{data.candidates.length ? 'Nothing matches.' : 'None right now. Decisions from the last 90 days show here while nobody else has acted on the record after you.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {candidates.map((c) => (
                <li key={`${c.entityType}:${c.entityId}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/${LINK[c.entityType]}/${c.entityId}`} className="font-mono text-sm font-semibold text-blue-700 hover:underline">{c.recordNo}</Link>
                      <span className="text-xs text-slate-500">{TYPE[c.entityType]} · now at {c.statusLabel}</span>
                    </div>
                    <div className="truncate text-xs text-slate-600">{c.itemCode} · {c.itemDescription} · {c.plantName}</div>
                    <div className="mt-0.5 text-xs text-slate-700">Your last decision: <span className="font-medium">{stepName(c.steps[0].action)}</span>, {formatDateTime(c.steps[0].at)}</div>
                  </div>
                  {c.pending
                    ? <Badge variant="warning">Request waiting</Badge>
                    : <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setOpen(c)}>Request reversal</Button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="section-title">Your reversal requests</h2></div>
          {data.requests.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">You have not asked for a reversal yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {data.requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/${LINK[r.entityType]}/${r.entityId}`} className="font-mono font-semibold text-blue-700 hover:underline">{r.recordNo}</Link>
                      <span className="text-xs text-slate-500">{TYPE[r.entityType]} · asked {formatDateTime(r.requestedAt)}{r.requestedStepAction ? ` · undo "${stepName(r.requestedStepAction)}"` : ''}</span>
                      <span className="ml-auto"><Badge variant={STATE[r.state][1]} dot={r.state === 'PENDING'}>{STATE[r.state][0]}</Badge></span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-slate-700">{r.reason}</p>
                    {r.state === 'REVERSED' && <p className="mt-1 text-xs text-slate-600">Reversed by {r.reviewedByName}, {formatDateTime(r.reviewedAt)}: {r.previousStatusLabel} → <span className="font-semibold">{r.revertedStatusLabel}</span></p>}
                    {r.state === 'REJECTED' && <p className="mt-1 text-xs text-slate-600">Not accepted by {r.reviewedByName}, {formatDateTime(r.reviewedAt)}</p>}
                    {r.reviewRemark && r.state !== 'WITHDRAWN' && <p className="mt-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">Admin: {r.reviewRemark}</p>}
                  </div>
                  {r.state === 'PENDING' && <Button size="sm" variant="secondary" loading={withdrawing.isLoading && withdrawing.originalArgs === r.id} onClick={() => take(r.id)}>Withdraw</Button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {open && (
        <RequestDialog data={{ steps: open.steps, statusLabel: open.statusLabel }} entityType={open.entityType} entityId={open.entityId} recordNo={open.recordNo} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
