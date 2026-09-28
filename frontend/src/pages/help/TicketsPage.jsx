import { PERMISSIONS, SUPPORT_KINDS, SUPPORT_PRIORITIES } from '@qmas/shared';
import { CheckCircle2, CircleDot, Clock, Flame, Inbox, LifeBuoy, Loader2, Plus, UserX } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetTicketCountsQuery, useGetTicketsQuery } from '../../api/supportApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import StatCards from '../../components/ui/StatCards.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { KIND_LOOK, PRIORITY_VARIANT, STATUS_VARIANT, kindOf, openReportIssue, priorityOf, statusOf } from './helpLook.js';

/** My tickets; for the support team also all tickets and the ones assigned to them. */
export default function TicketsPage() {
  const { can } = useAccess();
  const support = can(PERMISSIONS.SUPPORT_MANAGE);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = support ? (params.get('scope') ?? 'mine') : 'mine';
  const [status, setStatus] = useState(null);
  const [kind, setKind] = useState(null);
  const [priority, setPriority] = useState(null);
  const [flag, setFlag] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ sort: 'updatedAt', order: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const search = useDebounced(q);

  const { data: counts } = useGetTicketCountsQuery(scope);
  const { data, isFetching, error } = useGetTicketsQuery({
    scope, page, pageSize, ...sort,
    ...(status && { status }), ...(kind && { kind }), ...(priority && { priority }), ...(flag && { flag }), ...(search && { q: search }),
  });
  const pick = (setter) => (v) => { setter(v); setPage(1); };
  const toggleStatus = (v) => { setFlag(null); pick(setStatus)(status === v ? null : v); };
  const toggleFlag = (v) => { setStatus(null); pick(setFlag)(flag === v ? null : v); };

  const cards = [
    { key: 'all', label: 'All tickets', value: counts?.total, icon: Inbox, tone: 'blue', isTotal: true, active: !status && !flag, onClick: () => { setFlag(null); pick(setStatus)(null); } },
    { key: 'OPEN', label: 'Open', value: counts?.open, icon: CircleDot, tone: 'sky', active: status === 'OPEN', onClick: () => toggleStatus('OPEN') },
    { key: 'IN_PROGRESS', label: 'In progress', value: counts?.inProgress, icon: Loader2, tone: 'violet', active: status === 'IN_PROGRESS', onClick: () => toggleStatus('IN_PROGRESS') },
    { key: 'WAITING', label: support && scope !== 'mine' ? 'Waiting for reporter' : 'Waiting for you', value: counts?.waiting, icon: Clock, tone: 'amber', active: status === 'WAITING', onClick: () => toggleStatus('WAITING') },
    { key: 'RESOLVED', label: 'Resolved', value: counts?.resolved, icon: CheckCircle2, tone: 'green', active: status === 'RESOLVED', onClick: () => toggleStatus('RESOLVED') },
    ...(support && scope === 'all'
      ? [
          { key: 'urgent', label: 'High / critical open', value: counts?.urgent, icon: Flame, tone: 'rose', active: flag === 'urgent', onClick: () => toggleFlag('urgent') },
          { key: 'unassigned', label: 'Unassigned', value: counts?.unassigned, icon: UserX, tone: 'slate', active: flag === 'unassigned', onClick: () => toggleFlag('unassigned') },
        ]
      : []),
  ];

  const columns = [
    {
      key: 'ticketNo', header: 'Ticket', sortable: true, text: (t) => t.ticketNo,
      render: (t) => {
        const look = KIND_LOOK[t.kind];
        return (
          <div className="flex items-center gap-3 min-w-0">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${look.tile}`}><look.icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-800 max-w-md">{t.title}</div>
              <div className="text-xs text-slate-500"><span className="font-mono">{t.ticketNo}</span> · {kindOf(t.kind).label} · {t.module}</div>
            </div>
          </div>
        );
      },
    },
    ...(scope !== 'mine' ? [{ key: 'reportedByName', header: 'Reported by', render: (t) => <div><div className="text-sm text-slate-700">{t.reportedByName}</div><div className="text-xs text-slate-400">{t.reportedByCode}</div></div> }] : []),
    { key: 'priority', header: 'Priority', sortable: true, text: (t) => priorityOf(t.priority).label, render: (t) => <Badge variant={PRIORITY_VARIANT[t.priority]} dot>{priorityOf(t.priority).label}</Badge> },
    { key: 'status', header: 'Status', sortable: true, text: (t) => statusOf(t.status).label, render: (t) => <Badge variant={STATUS_VARIANT[t.status]}>{statusOf(t.status).label}</Badge> },
    { key: 'assignedToName', header: 'Assigned to', render: (t) => t.assignedToName ?? <span className="text-slate-400">Not yet</span> },
    { key: 'replyCount', header: 'Replies', align: 'right', render: (t) => <span className="tabular">{t.replyCount}</span> },
    { key: 'createdAt', header: 'Raised', sortable: true, text: (t) => formatDateTime(t.createdAt), render: (t) => <span title={formatDateTime(t.createdAt)}>{formatRelative(t.createdAt)}</span> },
    { key: 'updatedAt', header: 'Last update', sortable: true, text: (t) => formatDateTime(t.updatedAt), render: (t) => <span title={formatDateTime(t.updatedAt)}>{formatRelative(t.updatedAt)}</span> },
  ];

  return (
    <div>
      <PageHeader icon={LifeBuoy} title={scope === 'mine' ? 'My Tickets' : 'Support Desk'} subtitle={scope === 'mine' ? 'Problems, questions and requests you raised, and the replies from the support team.' : 'Every ticket raised in QMAS. Reply, assign and move them to resolved.'}>
        <Button size="sm" icon={Plus} onClick={() => openReportIssue()}>New ticket</Button>
      </PageHeader>
      <div className="p-5 space-y-4">
        {support && (
          <Tabs
            active={scope}
            onChange={(s) => { setParams(s === 'mine' ? {} : { scope: s }); setPage(1); setStatus(null); setPriority(null); setFlag(null); }}
            tabs={[{ key: 'mine', label: 'My tickets' }, { key: 'all', label: 'All tickets' }, { key: 'assigned', label: 'Assigned to me' }]}
          />
        )}
        <StatCards cards={cards} total={counts?.total} />
        <DataTable
          columns={columns}
          rows={data?.rows}
          loading={isFetching}
          error={error}
          tableId={`support-${scope}`}
          selectable
          exportName="support-tickets"
          sort={sort}
          onSort={(k) => { setSort((s) => ({ sort: k, order: s.sort === k && s.order === 'desc' ? 'asc' : 'desc' })); setPage(1); }}
          onRowClick={(t) => navigate(`/help/tickets/${t.id}`)}
          empty={scope === 'mine' ? 'You have not raised any tickets yet.' : 'No tickets match.'}
          emptyAction={scope === 'mine' ? <Button size="sm" icon={Plus} onClick={() => openReportIssue()}>Raise a ticket</Button> : null}
          pagination={data?.meta && { meta: data.meta, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }}
          leading={
            <>
              <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Ticket no, subject, reporter…" />
              <FilterSelect label="Type" value={kind} onChange={pick(setKind)} options={SUPPORT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
              <FilterSelect label="Priority" value={priority} onChange={pick(setPriority)} options={SUPPORT_PRIORITIES.map((k) => ({ value: k.value, label: k.label }))} />
              <FilterSelect label="Status" value={status} onChange={pick(setStatus)} options={[{ value: 'ACTIVE', label: 'Not resolved' }, { value: 'OPEN', label: 'Open' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'WAITING', label: 'Waiting' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'CLOSED', label: 'Closed' }]} />
            </>
          }
        />
      </div>
    </div>
  );
}
