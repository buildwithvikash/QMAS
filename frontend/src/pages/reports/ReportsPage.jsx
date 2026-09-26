import { REPORTS } from '@qmas/shared';
import { BarChart3, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useGetReportQuery } from '../../api/dnApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import { BarList } from '../../components/ui/Charts.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import FilterChips from '../../components/ui/FilterChips.jsx';
import { Select, TextInput } from '../../components/ui/fields.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { matchesFilter, ruleLabel } from '../../utils/filters.js';
import { loadPref, savePref } from '../../utils/prefs.js';

const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const FIELD_TYPE = { text: 'text', number: 'number', percent: 'number', date: 'date', datetime: 'date', bool: 'bool' };
const imirFilter = (field, value) => `/imirs?filter=${encodeURIComponent(JSON.stringify({ mode: 'all', rules: [{ field, op: 'equals', value }] }))}`;

function render(col, v) {
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
  switch (col.type) {
    case 'date': return <span className="whitespace-nowrap">{formatDate(v)}</span>;
    case 'datetime': return <span className="whitespace-nowrap text-xs">{formatDateTime(v)}</span>;
    case 'number': return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
    case 'percent': return `${Number(v).toFixed(1)} %`;
    case 'bool': return v ? <span className="font-semibold text-rose-700">Yes</span> : 'No';
    default: {
      const text = typeof v === 'string' && /^[A-Z_]+$/.test(v) && v.includes('_') ? v.replaceAll('_', ' ').toLowerCase() : String(v);
      return <span className="block max-w-[16rem] truncate whitespace-nowrap" title={text}>{text}</span>;
    }
  }
}

const ChartCard = ({ title, children }) => (
  <section className="card p-4 mb-3">
    <h2 className="section-title mb-3">{title}</h2>
    {children}
  </section>
);

/** A chart above the table for the reports where a picture says more than rows. */
function ReportChart({ report }) {
  if (report.key === 'vendor-quality') {
    const rows = report.rows.filter((r) => r.inspected > 0).sort((a, b) => b.nokPct - a.nokPct).slice(0, 10)
      .map((r) => ({ key: r.vendorCode, label: r.vendorName, value: r.nokPct ?? 0, note: `${r.nokLots} of ${r.inspected} lots not OK, ${r.rejected} rejected`, tone: r.nokPct >= 20 ? 'rose' : r.nokPct > 0 ? 'amber' : 'blue', to: imirFilter('vendorCode', r.vendorCode) }));
    return <ChartCard title="Not OK % by vendor (top 10)"><BarList rows={rows} max={100} format={(v) => `${v.toFixed(1)} %`} /></ChartCard>;
  }
  if (report.key === 'tat') {
    const rows = report.rows.filter((r) => r.completed > 0 || r.openNow > 0).map((r) => ({
      key: r.stage, label: r.stage, value: r.medianHours ?? 0,
      note: `average ${r.avgHours ?? '—'} h, 90 % within ${r.p90Hours ?? '—'} h${r.openNow ? `; ${r.openNow} waiting now, oldest ${r.oldestOpenHours} h` : ''}`,
      tone: r.openNow && r.oldestOpenHours > 72 ? 'rose' : r.openNow ? 'amber' : 'blue',
    }));
    return <ChartCard title="Median hours per stage"><BarList rows={rows} format={(v) => `${v} h`} /></ChartCard>;
  }
  if (report.key === 'pending-ageing') {
    const buckets = ['0-1 days', '2-3 days', '4-7 days', 'Over 7 days'];
    const rows = buckets.map((b, i) => ({ key: b, label: `Waiting ${b}`, value: report.rows.filter((r) => r.bucket === b).length, tone: i === 3 ? 'rose' : i === 2 ? 'amber' : 'blue' }));
    return <ChartCard title="Open lots by time in their current stage"><BarList rows={rows} format={(v) => `${v} lot${v === 1 ? '' : 's'}`} /></ChartCard>;
  }
  return null;
}

/** Registers and KPIs (M13): pick a report, a period and a plant; filter and sort any column; view or download as Excel. */
export default function ReportsPage() {
  const [key, setKey] = useState(() => loadPref('report', REPORTS[0].key));
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayIst());
  const [plantId, setPlantId] = useState(null);
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({});
  const { data: lookups } = useGetLookupsQuery();
  const { data, isFetching, error } = useGetReportQuery({ key, from, to, ...(plantId ? { plantId } : {}) });
  const meta = REPORTS.find((r) => r.key === key) ?? REPORTS[0];
  const dated = key !== 'pending-ageing';
  const xlsxUrl = `/api/v1/reports/${key}?${new URLSearchParams({ from, to, format: 'xlsx', ...(plantId ? { plantId } : {}) })}`;
  const current = data?.key === key ? data : null;

  const pick = (k) => {
    setKey(k);
    savePref('report', k);
  };
  const fields = useMemo(() => (current?.columns ?? []).map((c) => ({ key: c.key, label: c.header, type: FIELD_TYPE[c.type] ?? 'text' })), [current]);
  const spec = filters[key] ?? null;
  const s = sort[key];
  const rows = useMemo(() => {
    if (!current) return undefined;
    let out = current.rows.filter((r) => matchesFilter(r, spec, fields));
    if (s) {
      const dir = s.order === 'desc' ? -1 : 1;
      out = [...out].sort((a, b) => {
        const x = a[s.sort];
        const y = b[s.sort];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * dir;
      });
    }
    return out.map((r, i) => ({ ...r, _k: i }));
  }, [current, spec, fields, s]);

  const columns = (current?.columns ?? []).map((c) => ({
    key: c.key,
    header: c.header,
    sortable: true,
    align: c.type === 'number' || c.type === 'percent' ? 'right' : undefined,
    render: (r) => render(c, r[c.key]),
  }));
  const chips = (spec?.rules ?? []).map((r, i) => {
    const f = fields.find((x) => x.key === r.field);
    const rest = spec.rules.filter((_, j) => j !== i);
    return f && { key: `r${i}`, label: spec.mode === 'any' && i > 0 ? 'or' : 'Where', value: ruleLabel(r, f), onRemove: () => setFilters((x) => ({ ...x, [key]: rest.length ? { ...spec, rules: rest } : null })) };
  }).filter(Boolean);

  return (
    <div>
      <PageHeader icon={BarChart3} title="Reports" subtitle="Registers and KPIs for your plants. Filter or sort any column; Excel downloads the whole period.">
        <a href={xlsxUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><Download className="w-4 h-4" />Excel</a>
      </PageHeader>
      <div className="p-5 grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] items-start">
        <nav aria-label="Reports" className="card p-1.5 min-w-0 lg:sticky lg:top-28">
          <ul className="flex lg:block gap-1 overflow-x-auto no-scrollbar">
            {REPORTS.map((r) => {
              const on = r.key === key;
              return (
                <li key={r.key} className="shrink-0">
                  <button type="button" onClick={() => pick(r.key)} aria-current={on ? 'page' : undefined}
                    className={`w-full text-left rounded-md px-3 py-2 cursor-pointer transition-colors ${on ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>
                    <span className="block text-sm font-medium whitespace-nowrap">{r.name}</span>
                    <span className={`hidden lg:block text-xs leading-snug mt-0.5 ${on ? 'text-blue-100' : 'text-slate-500'}`}>{r.description}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <div className="flex flex-wrap gap-3 mb-3 items-end">
            {dated && <TextInput className="w-40" label={`${current?.dated ?? 'Date'} from`} type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />}
            {dated && <TextInput className="w-40" label="To" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />}
            <Select className="w-56" label="Plant" placeholder="All my plants" value={plantId ?? ''} onChange={setPlantId}
              options={(lookups?.plants ?? []).map((p) => ({ value: String(p.id), label: `${p.name} (${p.sapCode})` }))} />
            <span className="text-xs text-slate-600 pb-3">
              {current ? `${rows.length.toLocaleString('en-IN')}${rows.length !== current.rows.length ? ` of ${current.rows.length.toLocaleString('en-IN')}` : ''} row${current.rows.length === 1 ? '' : 's'}${current.truncated ? ' (first 20,000; narrow the period)' : ''}` : ''}
            </span>
          </div>
          {current && <ReportChart report={current} />}
          <DataTable key={key} tableId={`report-${key}`} columns={columns} rows={rows} rowKey="_k" loading={isFetching} error={error}
            sort={s} onSort={(k) => setSort((x) => ({ ...x, [key]: { sort: k, order: x[key]?.sort === k && x[key].order === 'asc' ? 'desc' : 'asc' } }))}
            filter={fields.length ? { fields, value: spec, onChange: (v) => setFilters((x) => ({ ...x, [key]: v })), storageKey: `report-${key}` } : undefined}
            toolbar={<FilterChips chips={chips} onClearAll={() => setFilters((x) => ({ ...x, [key]: null }))} />}
            empty={spec ? 'No rows match this filter.' : `Nothing in this period for ${meta.name.toLowerCase()}.`} />
        </div>
      </div>
    </div>
  );
}
