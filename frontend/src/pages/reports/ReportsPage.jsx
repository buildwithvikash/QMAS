import { REPORTS } from '@qmas/shared';
import { BarChart3, Download } from 'lucide-react';
import { useState } from 'react';
import { useGetReportQuery } from '../../api/dnApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import DataTable from '../../components/ui/DataTable.jsx';
import { Select, TextInput } from '../../components/ui/fields.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';

const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

function render(col, v) {
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
  switch (col.type) {
    case 'date': return <span className="whitespace-nowrap">{formatDate(v)}</span>;
    case 'datetime': return <span className="whitespace-nowrap text-xs">{formatDateTime(v)}</span>;
    case 'number': return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
    case 'percent': return `${Number(v).toFixed(1)} %`;
    case 'bool': return v ? <span className="font-semibold text-rose-600">Yes</span> : 'No';
    default: return typeof v === 'string' && /^[A-Z_]+$/.test(v) && v.includes('_') ? v.replaceAll('_', ' ').toLowerCase() : String(v);
  }
}

/** Registers and KPIs (M13): pick a report, a period and a plant; view here or download as Excel. */
export default function ReportsPage() {
  const [key, setKey] = useState(REPORTS[0].key);
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayIst());
  const [plantId, setPlantId] = useState(null);
  const { data: lookups } = useGetLookupsQuery();
  const params = { key, from, to, ...(plantId ? { plantId } : {}) };
  const { data, isFetching, error } = useGetReportQuery(params);
  const meta = REPORTS.find((r) => r.key === key);
  const dated = key !== 'pending-ageing';
  const xlsxUrl = `/api/v1/reports/${key}?${new URLSearchParams({ from, to, format: 'xlsx', ...(plantId ? { plantId } : {}) })}`;

  const columns = (data?.columns ?? []).map((c) => ({
    key: c.key,
    header: c.header,
    align: c.type === 'number' || c.type === 'percent' ? 'right' : undefined,
    render: (r) => render(c, r[c.key]),
  }));

  return (
    <div>
      <PageHeader icon={BarChart3} title="Reports" subtitle={meta.description}>
        <a href={xlsxUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><Download className="w-4 h-4" />Excel</a>
      </PageHeader>
      <div className="p-5">
        <Tabs tabs={REPORTS.map((r) => ({ key: r.key, label: r.name }))} active={key} onChange={setKey} />
        <div className="flex flex-wrap gap-3 mb-3 items-end">
          {dated && <TextInput className="w-40" label={`${data?.dated ?? 'Date'} from`} type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />}
          {dated && <TextInput className="w-40" label="To" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />}
          <Select className="w-56" label="Plant" placeholder="All my plants" value={plantId ?? ''} onChange={setPlantId}
            options={(lookups?.plants ?? []).map((p) => ({ value: String(p.id), label: `${p.sapCode} · ${p.name}` }))} />
          <span className="text-xs text-slate-500 pb-2">{data ? `${data.rows.length.toLocaleString('en-IN')} row${data.rows.length === 1 ? '' : 's'}${data.truncated ? ' (first 20,000 — narrow the period)' : ''}` : ''}</span>
        </div>
        <DataTable columns={columns} rows={data?.rows?.map((r, i) => ({ ...r, _k: i }))} rowKey="_k" loading={isFetching} error={error} empty="Nothing in this period." />
      </div>
    </div>
  );
}
