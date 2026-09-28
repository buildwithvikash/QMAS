import { REPORTS } from '@qmas/shared';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, ChevronRight, Download, EyeOff, LineChart, RotateCcw, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetReportQuery } from '../../api/dnApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import { BarList } from '../../components/ui/Charts.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import FilterChips from '../../components/ui/FilterChips.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { Columns, Donut, RankBars } from '../../components/ui/ReportCharts.jsx';
import { useClientTable } from '../../hooks/useClientTable.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { matchesFilter, ruleLabel } from '../../utils/filters.js';
import { loadPref, savePref } from '../../utils/prefs.js';
import { DeviationStage, DnStatus } from '../deviation/workflowUi.jsx';
import { ImirStatus } from '../imir/imirUi.jsx';
import { VIEWS } from './reportViews.js';

const DAY = 86_400_000;
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const isoOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - n * DAY));
const FIELD_TYPE = { text: 'text', number: 'number', percent: 'number', date: 'date', datetime: 'date', bool: 'bool' };
const TILE = {
  blue: ['bg-white', 'bg-blue-100 text-blue-600'], green: ['bg-emerald-50/50', 'bg-emerald-100 text-emerald-600'], amber: ['bg-amber-50/50', 'bg-amber-100 text-amber-600'],
  rose: ['bg-rose-50/50', 'bg-rose-100 text-rose-600'], violet: ['bg-violet-50/50', 'bg-violet-100 text-violet-600'],
};
const SPAN = { 1: '', 2: 'xl:col-span-2', 3: 'xl:col-span-3' };
const pill = (text, tone) => <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${tone}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{text}</span>;
const words = (v) => String(v).replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** How a report cell is shown: typed values, status pills, results, and the record number as a link. */
function cell(report, col, r) {
  const v = r[col.key];
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
  if (col.key === 'result') return pill(v === 'NOK' ? 'NOK' : 'OK', v === 'NOK' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700');
  if (col.key === 'status' && (report === 'imir-register' || report === 'pending-ageing')) return <ImirStatus status={v} />;
  if (col.key === 'status' && report === 'dn-register') return <DnStatus status={v} overdue={r.capaOverdue} />;
  if (col.key === 'stage' && report === 'deviation-register') return <DeviationStage stage={v} outcome={r.outcome} />;
  if (col.key === 'coverage') return pill(v, v === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700');
  if (col.key === 'bucket') return pill(v, v === 'Over 7 days' ? 'bg-rose-50 text-rose-700' : v === '4-7 days' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700');
  if (col.key === 'outcome') return pill(words(v), v === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700');
  const link = col.key === 'imirNo' && r.imirId ? `/imirs/${r.imirId}` : col.key === 'deviationNo' && r.deviationId ? `/deviations/${r.deviationId}` : col.key === 'dnNo' && r.dnId ? `/dns/${r.dnId}` : col.key === 'itemCode' && report === 'format-coverage' && r.itemId ? `/formats/items/${r.itemId}` : null;
  if (link) return <Link to={link} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700 whitespace-nowrap">{v}</Link>;
  switch (col.type) {
    case 'date': return <span className="whitespace-nowrap">{formatDate(v)}</span>;
    case 'datetime': return <span className="whitespace-nowrap text-xs">{formatDateTime(v)}</span>;
    case 'number': return <span className="tabular">{Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })}</span>;
    case 'percent': return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className="hidden sm:block w-14 h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${v >= 20 ? 'bg-rose-500' : v > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, v)}%` }} /></span>
        <span className="tabular">{Number(v).toFixed(1)}%</span>
      </span>
    );
    case 'bool': return v ? pill('Yes', 'bg-rose-50 text-rose-700') : <span className="text-slate-500">No</span>;
    default: {
      const text = typeof v === 'string' && /^[A-Z_]+$/.test(v) && v.includes('_') ? words(v) : String(v);
      return <span className="block max-w-[16rem] truncate whitespace-nowrap" title={text}>{text}</span>;
    }
  }
}

function Kpi({ k }) {
  const [card, tile] = TILE[k.tone] ?? TILE.blue;
  return (
    <div className={`card flex items-center gap-4 px-4 py-4 ${card}`}>
      <span className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center ${tile}`}><k.icon className="w-6 h-6" /></span>
      <div className="min-w-0">
        <p className="text-sm text-slate-600 truncate">{k.label}</p>
        <p className="flex items-center gap-2 text-2xl font-bold text-slate-900 tabular leading-tight">
          {k.value}
          {k.trend !== null && k.trend !== undefined && (
            <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${k.trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
              title="Compared with the period of the same length just before">
              {k.trend >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}{Math.abs(k.trend)}%
            </span>
          )}
        </p>
        <p className="text-xs text-slate-500 truncate">{k.note}</p>
      </div>
    </div>
  );
}

const GRANS = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']];

function Chart({ c }) {
  const [gran, setGran] = useState('day');
  return (
    <section className={`card p-4 min-w-0 ${SPAN[c.span ?? 1]}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">{c.title}</h3>
          {c.sub && <p className="text-xs text-slate-500">{c.sub}</p>}
        </div>
        {c.granular && (
          <select value={gran} onChange={(e) => setGran(e.target.value)} aria-label={`${c.title}: group by`} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 cursor-pointer">
            {GRANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
      </div>
      <div className="mt-3">
        {c.kind === 'donut' && <Donut segments={c.segments} />}
        {c.kind === 'columns' && <Columns data={typeof c.data === 'function' ? c.data(gran) : c.data} series={c.series} />}
        {c.kind === 'bars' && <BarList rows={c.rows} max={c.max} format={c.format ?? ((v) => v.toLocaleString('en-IN'))} empty="Nothing to show for this period." />}
        {c.kind === 'rank' && <RankBars rows={c.rows} total={c.total} />}
      </div>
    </section>
  );
}

/** Analysis tabs over the registers; a tab with two registers shows a switch between them. */
const TABS = [
  { key: 'overview', label: 'Overview', reports: ['imir-register'] },
  { key: 'lots', label: 'Lot Analysis', reports: ['tat'] },
  { key: 'vendors', label: 'Vendor Analysis', reports: ['vendor-quality'] },
  { key: 'items', label: 'Item Analysis', reports: ['item-quality', 'format-coverage'] },
  { key: 'deviations', label: 'Deviation Analysis', reports: ['deviation-register'] },
  { key: 'ageing', label: 'Ageing', reports: ['pending-ageing', 'dn-register'] },
  { key: 'download', label: 'Download', reports: [] },
];
const tabOf = (report) => TABS.find((t) => t.reports.includes(report))?.key ?? 'overview';
const pctChange = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

/** Registers and KPIs as analysis tabs: figures with the trend, charts, a searchable table, and Excel downloads. */
export default function ReportsPage() {
  const [key, setKey] = useState(() => { const k = loadPref('report', REPORTS[0].key); return REPORTS.some((r) => r.key === k) ? k : REPORTS[0].key; });
  const [tab, setTab] = useState(() => loadPref('report-tab', null) ?? tabOf(key));
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayIst());
  const [plantId, setPlantId] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({});
  const [showCharts, setShowCharts] = useState(() => loadPref('report-charts', true));
  const { data: lookups } = useGetLookupsQuery();
  const onDownload = tab === 'download';
  const { data, isFetching, error } = useGetReportQuery({ key, from, to, ...(plantId ? { plantId } : {}) }, { skip: onDownload });
  // The same report for the period of equal length just before, for the trend on the first tile.
  const span = Math.round((new Date(to) - new Date(from)) / DAY) + 1;
  const prevTo = isoOf(new Date(new Date(from).getTime() - DAY));
  const prevFrom = isoOf(new Date(new Date(from).getTime() - span * DAY));
  const dated = key !== 'pending-ageing';
  const { data: prev } = useGetReportQuery({ key, from: prevFrom, to: prevTo, ...(plantId ? { plantId } : {}) }, { skip: onDownload || !dated });
  const navigate = useNavigate();
  const meta = REPORTS.find((r) => r.key === key) ?? REPORTS[0];
  const view = VIEWS[key] ?? VIEWS['imir-register'];
  const xlsxUrl = (k) => `/api/v1/reports/${k}?${new URLSearchParams({ from, to, format: 'xlsx', ...(plantId ? { plantId } : {}) })}`;
  const current = data?.key === key ? data : null;

  const fields = useMemo(() => (current?.columns ?? []).map((c) => ({ key: c.key, label: c.header, type: FIELD_TYPE[c.type] ?? 'text' })), [current]);
  const spec = filters[key] ?? null;
  const narrow = useMemo(() => (list) => {
    const needle = q.trim().toLowerCase();
    return list.filter((r) => matchesFilter(r, spec, fields)).filter((r) => !needle || (current?.columns ?? []).some((c) => String(r[c.key] ?? '').toLowerCase().includes(needle)));
  }, [q, spec, fields, current]);
  const rows = useMemo(() => (current ? narrow(current.rows).map((r, i) => ({ ...r, _k: i })) : undefined), [current, narrow]);
  const prevRows = useMemo(() => (prev?.key === key ? narrow(prev.rows) : null), [prev, key, narrow]);
  const table = useClientTable(rows, { pageSize: 10 });
  const kpis = rows ? view.kpis(rows).map((k, i) => (i === 0 && prevRows && dated ? { ...k, trend: pctChange(rows.length, prevRows.length) } : k)) : null;
  const charts = rows ? view.charts(rows) : [];

  const openTab = (t) => {
    setTab(t);
    savePref('report-tab', t);
    const first = TABS.find((x) => x.key === t)?.reports[0];
    if (first && !TABS.find((x) => x.key === t).reports.includes(key)) pick(first);
  };
  const pick = (k) => { setKey(k); savePref('report', k); setQ(''); };
  const reset = () => { setFrom(daysAgo(30)); setTo(todayIst()); setPlantId(''); setQ(''); setFilters((x) => ({ ...x, [key]: null })); };
  const toggleCharts = () => { setShowCharts((s) => { savePref('report-charts', !s); return !s; }); };
  const tabDef = TABS.find((t) => t.key === tab) ?? TABS[0];

  const columns = (current?.columns ?? []).map((c) => ({
    key: c.key,
    header: c.header,
    sortable: true,
    align: c.type === 'number' || c.type === 'percent' ? 'right' : undefined,
    text: (r) => r[c.key] ?? '',
    render: (r) => cell(key, c, r),
  }));
  const chips = (spec?.rules ?? []).map((r, i) => {
    const f = fields.find((x) => x.key === r.field);
    const rest = spec.rules.filter((_, j) => j !== i);
    return f && { key: `r${i}`, label: spec.mode === 'any' && i > 0 ? 'or' : 'Where', value: ruleLabel(r, f), onRemove: () => setFilters((x) => ({ ...x, [key]: rest.length ? { ...spec, rules: rest } : null })) };
  }).filter(Boolean);
  const rowMenu = (r) => view.rowMenu(r).filter(Boolean).map((m) => ({ label: m.label, icon: m.icon, onClick: () => navigate(m.to) }));
  const inputCls = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500';
  const dateBox = 'bg-transparent text-sm text-slate-700 focus:outline-none cursor-pointer';

  return (
    <div>
      <PageHeader icon={BarChart3} title="Reports" subtitle="Registers and KPIs for your plants. Analyse, filter and export register data with interactive insights.">
        <span className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-300 bg-white" title="Period">
          <CalendarDays className="w-4 h-4 text-slate-400" />
          <input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={dateBox} />
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          <input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={dateBox} />
        </span>
        <select aria-label="Plant" value={plantId} onChange={(e) => setPlantId(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 cursor-pointer">
          <option value="">All plants</option>
          {(lookups?.plants ?? []).map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
        {!onDownload && (
          <button type="button" onClick={toggleCharts} title={showCharts ? 'Hide charts' : 'Show charts'} aria-label={showCharts ? 'Hide charts' : 'Show charts'}
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer">
            {showCharts ? <EyeOff className="w-4 h-4" /> : <LineChart className="w-4 h-4" />}
          </button>
        )}
        {!onDownload && <a href={xlsxUrl(key)} className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"><Download className="w-4 h-4" />Export to Excel</a>}
      </PageHeader>

      <div className="p-5 space-y-4">
        <div role="tablist" className="card px-2 flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => openTab(t.key)}
              className={`shrink-0 px-4 py-3 -mb-px border-b-2 text-sm cursor-pointer ${tab === t.key ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {onDownload ? <Downloads xlsxUrl={xlsxUrl} from={from} to={to} onOpen={(k) => { pick(k); setTab(tabOf(k)); savePref('report-tab', tabOf(k)); }} /> : (
          <>
            {tabDef.reports.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {tabDef.reports.map((k) => {
                  const r = REPORTS.find((x) => x.key === k);
                  const V = VIEWS[k];
                  return (
                    <button key={k} type="button" onClick={() => pick(k)} aria-pressed={key === k}
                      className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border text-sm font-medium cursor-pointer ${key === k ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {V && <V.icon className="w-4 h-4" />}{r?.name}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {kpis ? kpis.map((k) => <Kpi key={k.label} k={k} />) : [1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
            </div>

            {showCharts && rows && rows.length > 0 && (
              <div className="grid gap-4 xl:grid-cols-3">
                {charts.map((c) => <Chart key={`${key}-${c.title}`} c={c} />)}
              </div>
            )}

            <section className="card p-4 flex flex-wrap items-end gap-3">
              {dated && (
                <>
                  <label className="flex flex-col gap-1 w-40"><span className="text-xs font-medium text-slate-500">{current?.dated ?? 'Date'} from</span>
                    <input type="date" className={inputCls} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
                  <label className="flex flex-col gap-1 w-40"><span className="text-xs font-medium text-slate-500">To</span>
                    <input type="date" className={inputCls} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
                </>
              )}
              <label className="flex flex-col gap-1 w-56"><span className="text-xs font-medium text-slate-500">Plant</span>
                <select className={`${inputCls} cursor-pointer`} value={plantId} onChange={(e) => setPlantId(e.target.value)}>
                  <option value="">All plants</option>
                  {(lookups?.plants ?? []).map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select></label>
              <label className="flex flex-col gap-1 flex-1 min-w-56"><span className="text-xs font-medium text-transparent select-none" aria-hidden="true">Search</span>
                <span className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${meta.name.toLowerCase()} (IMIR, item, vendor, GRN…)`} aria-label="Search" className={`${inputCls} pl-9 pr-8`} />
                  {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>}
                </span></label>
              <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"><RotateCcw className="w-4 h-4" />Reset</button>
            </section>

            <DataTable
              key={key}
              tableId={`report-${key}`}
              rowKey="_k"
              columns={columns}
              rows={table.rows}
              loading={isFetching && !current}
              error={error}
              sort={table.sort}
              onSort={table.onSort}
              leading={(
                <span className="flex items-center gap-3 mr-auto">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${view.tone}`}><view.icon className="w-5 h-5" /></span>
                  <span>
                    <span className="block text-base font-bold text-slate-900">{meta.name} <span className="font-medium text-slate-400">({rows?.length ?? 0}{rows && current && rows.length !== current.rows.length ? ` of ${current.rows.length}` : ''})</span></span>
                    <span className="block text-xs text-slate-500">{dated ? `${current?.dated ?? 'Date'} ${formatDate(from)} – ${formatDate(to)}` : 'As of now'}{current?.truncated ? ' · first 20,000 rows; narrow the period' : ''}</span>
                  </span>
                </span>
              )}
              filter={fields.length ? { fields, value: spec, onChange: (v) => setFilters((x) => ({ ...x, [key]: v })), storageKey: `report-${key}` } : undefined}
              toolbar={chips.length > 0 && <FilterChips chips={chips} onClearAll={() => setFilters((x) => ({ ...x, [key]: null }))} />}
              rowMenu={key !== 'tat' ? rowMenu : undefined}
              selectable
              exportName={key}
              pagination={table.pagination}
              empty={spec || q ? 'No rows match these filters.' : `Nothing in this period for ${meta.name.toLowerCase()}.`}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Every register as Excel for the chosen period and plant, or opened on screen. */
function Downloads({ xlsxUrl, from, to, onOpen }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Each register downloads as an Excel workbook for {formatDate(from)} – {formatDate(to)} (Pending ageing: as of now), with the plant chosen above.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {REPORTS.map((r) => {
          const V = VIEWS[r.key];
          return (
            <section key={r.key} className="card p-4 flex flex-col">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${V?.tone ?? 'bg-slate-100 text-slate-600'}`}>{V && <V.icon className="w-5 h-5" />}</span>
              <h3 className="mt-3 text-sm font-bold text-slate-900">{r.name}</h3>
              <p className="mt-0.5 flex-1 text-xs text-slate-500">{r.description}</p>
              <div className="mt-3 flex gap-2">
                <a href={xlsxUrl(r.key)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"><Download className="w-3.5 h-3.5" />Excel</a>
                <button type="button" onClick={() => onOpen(r.key)} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">Open<ChevronRight className="w-3.5 h-3.5" /></button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
