import { CheckCircle2, Undo2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApproveReversalMutation, useGetReversalQuery, useGetReversalsQuery, useRejectReversalMutation } from '../../api/reversalApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { FormError, TextArea } from '../../components/ui/fields.jsx';
import { FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { done } from '../../utils/notify.jsx';
import { HISTORY_LABELS } from '../deviation/historyFormat.js';

const STATE = { PENDING: ['Waiting', 'warning'], REVERSED: ['Reversed', 'success'], REJECTED: ['Rejected', 'danger'], WITHDRAWN: ['Withdrawn', 'neutral'] };
const TYPE = { IMIR: 'IMIR', DEVIATION: 'Deviation', DN: 'DN / CAPA' };
const LINK = { IMIR: 'imirs', DEVIATION: 'deviations', DN: 'dns' };
const stepName = (a) => (a ? HISTORY_LABELS[a] ?? a : null);

/**
 * Reversal requests from the people responsible for a step, and the audit trail of every
 * reversal: who asked, who decided, when, the status before and after, and both reasons.
 */
export default function ReversalsPage() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState('PENDING');
  const [entityType, setEntityType] = useState(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const search = useDebounced(q);
  const openId = params.get('open') ? Number(params.get('open')) : null;
  const setOpen = (id) => setParams(id ? { open: String(id) } : {}, { replace: true });
  const { data, isFetching, error } = useGetReversalsQuery(
    { page, pageSize, ...(state !== 'ALL' && { state }), ...(entityType && { entityType }), ...(search && { q: search }) },
    { pollingInterval: 60_000 },
  );

  const columns = [
    {
      key: 'recordNo', header: 'Record', text: (r) => r.recordNo,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-mono font-semibold text-slate-900">{r.recordNo}</div>
          <div className="truncate text-xs text-slate-500">{TYPE[r.entityType]} · {r.itemCode} · {r.plantName}</div>
        </div>
      ),
    },
    { key: 'statusAtRequest', header: 'Stage when asked', text: (r) => r.statusAtRequestLabel },
    { key: 'requestedBy', header: 'Requested by', text: (r) => r.requestedByName, render: (r) => <div><div className="text-slate-900">{r.requestedByName}</div><div className="text-xs text-slate-500">{r.requestedRoleName ?? ''}</div></div> },
    { key: 'requestedAt', header: 'Asked', text: (r) => formatDateTime(r.requestedAt), render: (r) => <span title={formatDateTime(r.requestedAt)} className="whitespace-nowrap">{formatRelative(r.requestedAt)}</span> },
    { key: 'reason', header: 'Reason', text: (r) => r.reason, render: (r) => <span className="line-clamp-2 max-w-xs text-slate-700">{r.reason}</span> },
    { key: 'change', header: 'Reversed', text: (r) => (r.state === 'REVERSED' ? `${r.previousStatusLabel} → ${r.revertedStatusLabel}` : ''), render: (r) => (r.state === 'REVERSED' ? <span className="text-xs">{r.previousStatusLabel} → <span className="font-semibold">{r.revertedStatusLabel}</span></span> : '—') },
    { key: 'reviewedBy', header: 'Decided by', text: (r) => r.reviewedByName ?? '', render: (r) => (r.reviewedAt ? <div><div>{r.reviewedByName}</div><div className="text-xs text-slate-500 whitespace-nowrap">{formatDateTime(r.reviewedAt)}</div></div> : '—') },
    { key: 'state', header: 'Status', text: (r) => STATE[r.state][0], render: (r) => <Badge variant={STATE[r.state][1]} dot={r.state === 'PENDING'}>{STATE[r.state][0]}</Badge> },
  ];

  return (
    <div>
      <PageHeader icon={Undo2} title="Reversal Requests" subtitle="Requests to set an IMIR, deviation or DN back to an earlier step. Every request and reversal is kept as an audit trail." />
      <div className="p-5 space-y-4">
        <Tabs active={state} onChange={(s) => { setState(s); setPage(1); }}
          tabs={[{ key: 'PENDING', label: `Waiting${data?.meta?.pending ? ` (${data.meta.pending})` : ''}` }, { key: 'REVERSED', label: 'Reversed' }, { key: 'REJECTED', label: 'Rejected' }, { key: 'ALL', label: 'All' }]} />
        <DataTable
          columns={columns}
          rows={data?.rows}
          loading={isFetching}
          error={error}
          activeKey={openId}
          onRowClick={(r) => setOpen(r.id)}
          exportName="reversal-requests"
          empty={state === 'PENDING' ? 'No requests waiting.' : 'No requests match.'}
          pagination={data?.meta && { meta: data.meta, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }}
          leading={(
            <>
              <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Record no. or requester…" />
              <FilterSelect label="Record" value={entityType} onChange={(v) => { setEntityType(v ?? null); setPage(1); }} options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))} />
            </>
          )}
        />
      </div>
      {openId && <RequestDrawer id={openId} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RequestDrawer({ id, onClose }) {
  const { data: r, isFetching } = useGetReversalQuery(id);
  const [stepId, setStepId] = useState(null);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState(null);
  const [approve, approving] = useApproveReversalMutation();
  const [reject, rejecting] = useRejectReversalMutation();
  const chosen = stepId ?? r?.requestedStep ?? r?.steps[0]?.id ?? null;
  const pending = r?.state === 'PENDING';
  const moved = pending && r.currentStatus !== r.statusAtRequest;

  const run = async (kind) => {
    setError(null);
    if (kind === 'reject' && !remark.trim()) return setError('Enter the reason for rejecting the request.');
    try {
      if (kind === 'approve') await approve({ id, stepId: chosen, remark: remark.trim() || undefined }).unwrap();
      else await reject({ id, remark: remark.trim() }).unwrap();
      done(kind === 'approve' ? `${r.recordNo} reversed. The requester has been notified.` : 'Request rejected. The requester has been notified.');
      setRemark('');
    } catch (err) {
      setError(apiError(err).message);
    }
  };

  return (
    <Drawer
      label="Reversal request"
      title={r ? `${TYPE[r.entityType]} ${r.recordNo}` : 'Reversal request'}
      badge={r && <Badge variant={STATE[r.state][1]}>{STATE[r.state][0]}</Badge>}
      subtitle={r ? `Asked by ${r.requestedByName} · ${formatDateTime(r.requestedAt)}` : ''}
      onClose={onClose}
      footer={pending && (
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="secondary" icon={XCircle} loading={rejecting.isLoading} onClick={() => run('reject')}>Reject request</Button>
          <Button variant="danger" icon={CheckCircle2} disabled={!chosen || moved} loading={approving.isLoading} onClick={() => run('approve')}>Reverse</Button>
        </div>
      )}
    >
      {!r && isFetching && <p className="text-sm text-slate-500">Loading…</p>}
      {r && (
        <>
          <FormError message={error} />
          <section className="card p-4">
            <dl className="space-y-1.5 text-sm">
              {[
                ['Record', <Link key="l" to={`/${LINK[r.entityType]}/${r.entityId}`} className="font-mono text-blue-700 hover:underline">{r.recordNo}</Link>],
                ['Lot', `${r.imirNo ?? ''} · ${r.itemCode} · ${r.itemDescription}`],
                ['Plant', r.plantName],
                ['Requested by', `${r.requestedByName}${r.requestedRoleName ? ` (${r.requestedRoleName})` : ''}`],
                ['Asked on', formatDateTime(r.requestedAt)],
                ['Stage when asked', r.statusAtRequestLabel],
                pending && ['Stage now', r.currentStatusLabel],
                r.requestedStepAction && ['Asked to undo', stepName(r.requestedStepAction)],
                ['Reason', r.reason],
                r.reviewedAt && [r.state === 'WITHDRAWN' ? 'Withdrawn' : 'Decided by', `${r.reviewedByName} · ${formatDateTime(r.reviewedAt)}`],
                r.state === 'REVERSED' && ['Undid', stepName(r.undoneStepAction)],
                r.state === 'REVERSED' && ['Stage before', r.previousStatusLabel],
                r.state === 'REVERSED' && ['Stage after', r.revertedStatusLabel],
                r.reviewRemark && ['Admin remark', r.reviewRemark],
              ].filter(Boolean).filter((x) => x[1]).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2"><dt className="text-slate-500">{k}</dt><dd className="min-w-0 whitespace-pre-line wrap-break-word text-slate-800">{v}</dd></div>
              ))}
            </dl>
          </section>

          {pending && (
            <section className="card p-4 space-y-3">
              {moved && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">The record has moved on since the request. Reject it; the user can ask again.</p>}
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-semibold text-slate-600">Set the record back to just before</legend>
                {r.steps.length === 0 && <p className="text-sm text-slate-500">No step can be reversed on this record.</p>}
                {r.steps.map((s) => (
                  <label key={s.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${chosen === s.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                    <input type="radio" name="rev-step" className="mt-1" checked={chosen === s.id} onChange={() => setStepId(s.id)} />
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-900">{stepName(s.action)}</span>
                      {s.id === r.requestedStep && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">asked</span>}
                      <span className="text-slate-500"> · {s.actorName ?? 'System'} · {formatDateTime(s.at)}</span>
                      <span className="block text-xs text-slate-600">Goes back to: <span className="font-medium">{s.beforeLabel}</span></span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <TextArea label="Remark (required to reject)" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} />
            </section>
          )}
        </>
      )}
    </Drawer>
  );
}
