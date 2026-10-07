import { CalendarClock, CalendarDays, ChevronDown, ChevronRight, CircleAlert, FileWarning, FileX2, PieChart, Truck, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHomeSummary } from './useHomeSummary.js';
import { HomeCard, ViewAll } from './homeUi.jsx';

const link = (rules) => `/imirs?filter=${encodeURIComponent(JSON.stringify({ mode: 'all', rules }))}`;

// The IST calendar days the dashboard counts: today and the `days - 1` days before it.
const istDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const receivedIn = (days) => ({ field: 'receivedAt', op: 'between', value: [istDay(new Date(Date.now() - (days - 1) * 86_400_000)), istDay(new Date())] });

const PERIODS = [[30, 'Last 30 days'], [90, 'Last 90 days'], [180, 'Last 6 months'], [365, 'Last 12 months']];

/** Colours of a vendor row by how bad its rate is: red at 50 % and above, orange below. */
const toneOf = (pct) => (pct >= 50
  ? { row: 'bg-rose-50/70 border-rose-100', rank: 'bg-rose-100 text-rose-600', bar: 'bg-rose-500', box: 'bg-rose-100/70', text: 'text-rose-600' }
  : { row: 'bg-orange-50/70 border-orange-100', rank: 'bg-orange-100 text-orange-600', bar: 'bg-orange-500', box: 'bg-orange-100/60', text: 'text-orange-600' });

/** Vendors with the highest share of Not OK lots in the chosen period; click one for its Not OK lots. */
export function VendorNokRate() {
  const { s, periods, setPeriod } = useHomeSummary();
  const days = periods.vendorDays;
  const setDays = (d) => setPeriod('vendorDays', d);
  const vendors = s?.worstVendors ?? [];
  const label = PERIODS.find(([d]) => d === days)[1].toLowerCase();
  return (
    <section className="card flex flex-col px-4 py-3" aria-label="Vendor Not OK Rate">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-[13rem] flex-1 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-100 text-rose-600"><UsersRound className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-900">Vendor Not OK Rate</h2>
            <p className="text-xs text-slate-500">Lots not OK by vendor, received in the {label}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
        <label className="relative inline-flex items-center">
          <CalendarDays className="pointer-events-none absolute left-2.5 h-4 w-4 text-slate-500" />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"
            className="h-9 appearance-none rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-7 text-xs font-medium text-slate-700 outline-none cursor-pointer focus:border-blue-500">
            {PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-slate-500" />
        </label>
        <Link to="/reports" className="inline-flex h-9 items-center gap-1 rounded-lg border border-blue-100 bg-blue-50/50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50">
          View all<ChevronRight className="h-3.5 w-3.5" />
        </Link>
        </div>
      </div>
      {!s && <div className="mt-4 space-y-2">{[1, 2].map((k) => <div key={k} className="skeleton h-20" />)}</div>}
      {s && !vendors.length && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800">No vendor has a Not OK lot in the {label}.</p>}
      <ol className="mt-3 space-y-2">
        {vendors.map((v, k) => {
          const t = toneOf(v.nokPct);
          return (
            <li key={v.vendorCode}>
              <Link to={link([{ field: 'vendorCode', op: 'equals', value: v.vendorCode }, { field: 'result', op: 'in', value: ['NOK'] }, receivedIn(days)])}
                className={`group flex items-center gap-3 rounded-xl border px-3 py-2 transition-shadow hover:shadow-sm ${t.row}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${t.rank}`}>{k + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700" title={v.name}>{v.name}</span>
                  <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-slate-200/70"><span className={`block h-full rounded-full ${t.bar}`} style={{ width: `${Math.max(3, v.nokPct)}%` }} /></span>
                  <span className="mt-1 block text-[11px] text-slate-500"><b className="text-slate-700">{v.nok}</b> of {v.inspected} lots not OK</span>
                </span>
                <span className={`hidden shrink-0 items-center gap-2 rounded-lg px-2.5 py-1 sm:flex ${t.box}`}>
                  <CircleAlert className={`h-5 w-5 ${t.text}`} />
                  <span>
                    <span className="block text-[10px] text-slate-500">Not OK rate</span>
                    <span className={`block text-sm font-bold leading-tight tabular ${t.text}`}>{v.nokPct.toFixed(1)}%</span>
                    <span className="block text-[10px] text-slate-500">{v.nok} / {v.inspected} lots</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Donut of the period's lots (OK, Not OK, not yet inspected) and four open-work figures. */
export function PlantGlance() {
  const { s, periods, setPeriod } = useHomeSummary();
  const days = periods.glanceDays;
  const setDays = (d) => setPeriod('glanceDays', d);
  const l = s?.lots30Days;
  const parts = l ? [
    ['OK', l.ok, '#22c55e'],
    ['Not OK', l.nok, '#e11d48'],
    ['Not yet inspected', Math.max(0, l.received - l.ok - l.nok), 'var(--color-slate-300)'],
  ] : [];
  const total = l?.received ?? 0;
  const R = 15.9155; // circumference 100
  // Each segment starts where the one before ended (from 12 o'clock, clockwise).
  const starts = parts.map((_, i) => 25 - parts.slice(0, i).reduce((a, p) => a + (total ? (p[1] / total) * 100 : 0), 0));
  const tiles = s ? [
    { icon: Truck, label: 'Lots Received', value: total, note: `Last ${days} days`, tone: 'bg-blue-50 text-blue-700', to: link([receivedIn(days)]) },
    { icon: FileWarning, label: 'Open Deviations', value: s.openDeviations, note: s.openDeviations ? 'Requiring action' : 'None open', tone: 'bg-amber-50 text-amber-700', to: '/deviations' },
    { icon: FileX2, label: 'Open DNs', value: s.dn.open + s.dn.capaSubmitted, note: s.dn.capaOverdue ? 'CAPA overdue' : `${s.dn.capaSubmitted} CAPA to review`, tone: 'bg-rose-50 text-rose-700', to: '/dns' },
    { icon: CalendarClock, label: 'CAPA Due', value: s.dn.capaDueSoon ?? 0, note: s.dn.capaOverdue ? `${s.dn.capaOverdue} overdue` : 'Within 7 days', tone: 'bg-rose-50 text-rose-700', to: '/dns' },
  ] : [];
  return (
    <HomeCard icon={PieChart} title="Plant at glance"
      action={(
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-500">
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
      )}>
      {s && (
        <>
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 42 42" className="h-24 w-24 shrink-0" role="img" aria-label={`${total} lots: ${parts.map(([n, v]) => `${v} ${n}`).join(', ')}`}>
              <circle cx="21" cy="21" r={R} fill="none" strokeWidth="6" style={{ stroke: 'var(--color-slate-100)' }} />
              {total > 0 && parts.map(([name, v, c], i) => {
                const pct = (v / total) * 100;
                return <circle key={name} cx="21" cy="21" r={R} fill="none" strokeWidth="6" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={starts[i]} style={{ stroke: c }} />;
              })}
              <text x="21" y="21" textAnchor="middle" className="fill-slate-900 text-[8px] font-bold">{total}</text>
              <text x="21" y="27" textAnchor="middle" className="fill-slate-500 text-[3.5px]">Lots</text>
            </svg>
            <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
              {parts.map(([name, v, c]) => (
                <li key={name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />
                  <span className="min-w-0 flex-1 truncate text-slate-700">{name}</span>
                  <span className="font-semibold tabular text-slate-900">{v}</span>
                  <span className="w-10 text-right text-xs tabular text-slate-500">({total ? Math.round((100 * v) / total) : 0}%)</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((t) => (
              <Link key={t.label} to={t.to} className={`rounded-xl px-2 py-1.5 text-center transition-opacity hover:opacity-80 ${t.tone}`}>
                <t.icon className="mx-auto h-4 w-4" />
                <span className="mt-1 block text-[11px] font-medium text-slate-600">{t.label}</span>
                <span className="block text-base font-bold tabular text-slate-900">{t.value}</span>
                <span className="block truncate text-[10px]">{t.note}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      {!s && <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>}
    </HomeCard>
  );
}
