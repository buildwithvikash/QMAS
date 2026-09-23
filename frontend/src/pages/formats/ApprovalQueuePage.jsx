import { ListChecks } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetApprovalQueueQuery } from '../../api/formatsApi.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { SOURCE } from './formatHelpers.js';
import { StatusBadge, VersionTag } from './formatUi.jsx';

/** Submitted formats, oldest submission first (blueprint cases 3–4: timestamp decides the order). */
export default function ApprovalQueuePage() {
  const { data, isFetching, error } = useGetApprovalQueueQuery(undefined, { pollingInterval: 60_000 });
  const navigate = useNavigate();
  const columns = [
    { key: 'order', header: '#', render: (r) => <span className="text-slate-400 tabular">{data.indexOf(r) + 1}</span> },
    { key: 'submittedAt', header: 'Submitted', render: (r) => <span className="whitespace-nowrap" title={formatDateTime(r.submittedAt)}>{formatRelative(r.submittedAt)}</span> },
    { key: 'itemCode', header: 'Item', render: (r) => <div><span className="font-mono text-xs font-semibold text-slate-800">{r.itemCode}</span><div className="text-xs text-slate-500">{r.itemDescription}</div></div> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'source', header: 'Source', render: (r) => SOURCE[r.source] },
    {
      key: 'base',
      header: 'Change to',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          {r.baseVersionNo ? <VersionTag no={r.baseVersionNo} /> : 'new format'}
          {r.behindCurrent && r.currentVersionNo && <Badge variant="warning">now v{r.currentVersionNo}: will merge</Badge>}
        </span>
      ),
    },
    { key: 'checkpointCount', header: 'Checkpoints', align: 'right' },
    { key: 'submittedByName', header: 'Submitted by' },
  ];
  return (
    <div>
      <PageHeader icon={ListChecks} title="Format Approval Queue" subtitle="Oldest submission first" />
      <div className="p-5">
        <DataTable columns={columns} rows={data} loading={isFetching} error={error} onRowClick={(r) => navigate(`/formats/versions/${r.id}`)} empty="Nothing waiting for approval." />
      </div>
    </div>
  );
}
