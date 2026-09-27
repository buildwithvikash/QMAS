import { AlertTriangle, CheckCircle2, Clock, ExternalLink, GitMerge, ListChecks, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetApprovalQueueQuery } from '../../api/formatsApi.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCards from '../../components/ui/StatCards.jsx';
import { useClientTable } from '../../hooks/useClientTable.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { SOURCE } from './formatHelpers.js';
import { StatusBadge, VersionTag } from './formatUi.jsx';

const DAY = 86_400_000;
const STATUS_OPTIONS = [
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'CONFLICT', label: 'Merge conflict' },
  { value: 'MERGE', label: 'Will merge on approval' },
];

/** Submitted formats, oldest submission first (blueprint cases 3–4: the timestamp decides the order). */
export default function ApprovalQueuePage() {
  const { data, isFetching, error } = useGetApprovalQueueQuery(undefined, { pollingInterval: 60_000 });
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(undefined);
  const queue = useMemo(() => (data ?? []).map((r, i) => ({ ...r, position: i + 1, waitingDays: Math.floor((Date.now() - new Date(r.submittedAt)) / DAY) })), [data]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return queue.filter((r) => (!needle || [r.itemCode, r.itemDescription, r.submittedByName, r.createdByName].some((v) => v?.toLowerCase().includes(needle)))
      && (!status || (status === 'MERGE' ? r.behindCurrent && r.currentVersionNo && r.status === 'PENDING_APPROVAL' : r.status === status)));
  }, [queue, q, status]);
  const table = useClientTable(shown, { sort: 'position', order: 'asc' });

  const oldest = queue.reduce((m, r) => Math.max(m, r.waitingDays), 0);
  const conflicts = queue.filter((r) => r.status === 'CONFLICT').length;
  const merging = queue.filter((r) => r.behindCurrent && r.currentVersionNo && r.status === 'PENDING_APPROVAL').length;
  const cards = [
    { key: 'all', label: 'Waiting for approval', value: data ? queue.length : undefined, icon: Send, tone: 'blue', isTotal: true, active: !status, onClick: () => setStatus(undefined), note: queue.length ? `${queue.filter((r) => !r.baseVersionNo).length} new format(s)` : 'Nothing waiting' },
    { key: 'conflict', label: 'Merge conflicts', value: data ? conflicts : undefined, icon: AlertTriangle, tone: 'rose', active: status === 'CONFLICT', onClick: () => setStatus(status === 'CONFLICT' ? undefined : 'CONFLICT') },
    { key: 'merge', label: 'Will merge', value: data ? merging : undefined, icon: GitMerge, tone: 'violet', active: status === 'MERGE', onClick: () => setStatus(status === 'MERGE' ? undefined : 'MERGE') },
    { key: 'oldest', label: 'Oldest waiting', value: data ? `${oldest} d` : undefined, icon: Clock, tone: oldest > 3 ? 'amber' : 'green', isTotal: true, note: queue.length ? 'since the first submission' : 'Nothing waiting', onClick: () => table.onSort('position') },
  ];

  const columns = [
    { key: 'position', header: '#', sortable: true, text: (r) => r.position, render: (r) => <span className="inline-flex w-7 h-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 tabular">{r.position}</span> },
    {
      key: 'itemCode', header: 'Item', sortable: true, text: (r) => `${r.itemCode} ${r.itemDescription}`,
      render: (r) => (
        <div>
          <Link to={`/formats/versions/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700">{r.itemCode}</Link>
          <div className="text-xs text-slate-500 max-w-72 truncate">{r.itemDescription}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, text: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'base', header: 'Change to', text: (r) => (r.baseVersionNo ? `v${r.baseVersionNo}` : 'new format'),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {r.baseVersionNo ? <VersionTag no={r.baseVersionNo} /> : <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">New format</span>}
          {r.behindCurrent && r.currentVersionNo && <Badge variant="warning">now v{r.currentVersionNo}: will merge</Badge>}
        </span>
      ),
    },
    { key: 'source', header: 'Source', text: (r) => SOURCE[r.source], render: (r) => <span className="text-sm text-slate-700">{SOURCE[r.source]}</span> },
    { key: 'checkpointCount', header: 'Checks', sortable: true, align: 'right', render: (r) => <span className="tabular">{r.checkpointCount}</span> },
    { key: 'submittedByName', header: 'Submitted by', sortable: true, render: (r) => <span className="text-sm text-slate-800">{r.submittedByName ?? r.createdByName}</span> },
    {
      key: 'waitingDays', header: 'Waiting', sortable: true, text: (r) => formatDateTime(r.submittedAt),
      render: (r) => (
        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${r.waitingDays > 3 ? 'bg-rose-50 text-rose-700' : r.waitingDays > 1 ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`} title={formatDateTime(r.submittedAt)}>
          <Clock className="w-3 h-3" />{formatRelative(r.submittedAt)}
        </span>
      ),
    },
  ];
  const rowMenu = (r) => [
    { label: r.status === 'CONFLICT' ? 'Resolve conflicts' : 'Review & approve', icon: r.status === 'CONFLICT' ? GitMerge : CheckCircle2, onClick: () => navigate(r.status === 'CONFLICT' ? `/formats/versions/${r.id}/conflicts` : `/formats/versions/${r.id}`) },
    { label: 'Item formats', icon: ExternalLink, onClick: () => navigate(`/formats/items/${r.itemId}`) },
  ];

  return (
    <div>
      <PageHeader icon={ListChecks} title="Format Approval Queue" subtitle="Submitted formats, oldest submission first. Open one to see its changes and approve or return it." />
      <div className="p-5 space-y-4">
        <StatCards cards={cards} total={queue.length} />
        <DataTable
          tableId="format-queue"
          columns={columns}
          rows={table.rows}
          loading={isFetching && !data}
          error={error}
          sort={table.sort}
          onSort={table.onSort}
          leading={(
            <>
              <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} placeholder="All waiting" width="w-52" />
              <SearchBox value={q} onChange={setQ} placeholder="Item, description, submitted by…" />
            </>
          )}
          onRowClick={(r) => navigate(`/formats/versions/${r.id}`)}
          rowMenu={rowMenu}
          selectable
          exportName="format-approval-queue"
          pagination={table.pagination}
          empty={q || status ? 'Nothing matches these filters.' : 'Nothing waiting for approval.'}
        />
      </div>
    </div>
  );
}
