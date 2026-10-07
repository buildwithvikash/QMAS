import {
  Activity, AlarmClock, AlertTriangle, ArrowUpDown, Boxes, CheckCircle2, ClipboardList, Clock, ExternalLink, FileCheck2, FileText, FileWarning, FileX2, Gauge, Hourglass, Layers, PackageOpen,
  Percent, Scale, Timer, TrendingUp, Users,
} from 'lucide-react';
import { PALETTE as C } from '../../utils/palette.js';

/**
 * What each report shows above its table: KPI tiles, charts, and the actions of a row. Everything is
 * computed from the rows on screen, so tiles and charts follow the period, plant, search and filters.
 */

const n = (v) => Number(v ?? 0);
const sum = (rows, k) => rows.reduce((a, r) => a + n(r[k]), 0);
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '0%');
const avg = (rows, k) => (rows.length ? Math.round((sum(rows, k) / rows.length) * 10) / 10 : 0);
const distinct = (rows, k) => new Set(rows.map((r) => r[k]).filter(Boolean)).size;
const words = (v) => (v ? String(v).replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'None');
/** [{ label, value }] counted by a key, largest first. */
function countBy(rows, key, label = (v) => v ?? '—') {
  const m = new Map();
  for (const r of rows) m.set(label(r[key], r), (m.get(label(r[key], r)) ?? 0) + 1);
  return [...m.entries()].map(([l, value]) => ({ label: l, value })).sort((a, b) => b.value - a.value);
}
const bars = (list, tone = 'blue', top = 8, note) => list.slice(0, top).map((x) => ({ key: x.label, label: x.label, value: x.value, tone, note: note?.(x) }));
const ORDER = [C.blue, C.green, C.amber, C.violet, C.sky, C.red, C.teal, C.orange, C.indigo, C.slate];
const donut = (list, colors = {}) => list.map((x, i) => ({ ...x, color: colors[x.label] ?? ORDER[i % ORDER.length] }));
const dayLabel = (d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${String(d).slice(0, 10)}T00:00:00Z`));
/**
 * Columns per day, week (starting Monday) or month between the first and last date in the rows,
 * empty buckets included, each split into series by `seriesOf(row)`.
 */
function bucketed(rows, dateKey, seriesOf, gran = 'day') {
  const keyOf = (iso) => {
    if (gran === 'month') return iso.slice(0, 7);
    if (gran === 'week') {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    }
    return iso;
  };
  const labelOf = (k) => (gran === 'month' ? new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${k}-01T00:00:00Z`)) : `${gran === 'week' ? 'Wk ' : ''}${dayLabel(k)}`);
  const days = rows.map((r) => String(r[dateKey] ?? '').slice(0, 10)).filter(Boolean).sort();
  if (!days.length) return [];
  const out = [];
  const seen = new Set();
  for (let d = new Date(`${days[0]}T00:00:00Z`); d <= new Date(`${days.at(-1)}T00:00:00Z`) && out.length < 120; d = new Date(d.getTime() + 86_400_000)) {
    const k = keyOf(d.toISOString().slice(0, 10));
    if (!seen.has(k)) { seen.add(k); out.push({ key: k, label: labelOf(k), values: {} }); }
  }
  const at = new Map(out.map((x) => [x.key, x]));
  for (const r of rows) {
    const day = String(r[dateKey] ?? '').slice(0, 10);
    const x = day && at.get(keyOf(day));
    if (!x) continue;
    const series = seriesOf(r);
    x.values[series] = (x.values[series] ?? 0) + 1;
  }
  return out;
}
const imirLink = (field, value) => `/imirs?filter=${encodeURIComponent(JSON.stringify({ mode: 'all', rules: [{ field, op: 'equals', value }] }))}`;

const CLOSED = ['CLOSED_ACCEPTED', 'CLOSED_REJECTED', 'CLOSED_UNDER_DEVIATION', 'AUTO_CLOSED'];
const IMIR_GROUP = (s) => (s === 'AWAITING_FORMAT' ? 'Waiting for format' : s === 'OPEN' || s === 'IN_INSPECTION' ? 'To inspect / inspecting'
  : s === 'CLOSED_ACCEPTED' ? 'Accepted' : s === 'CLOSED_UNDER_DEVIATION' ? 'Accepted under deviation' : s === 'CLOSED_REJECTED' ? 'Rejected' : s === 'AUTO_CLOSED' ? 'Auto-closed' : 'In review / decision');
const STAGE_NAMES = {
  AWAITING_FORMAT: 'Waiting for format', OPEN: 'To inspect', IN_INSPECTION: 'Inspecting', SUBMITTED: 'Incharge review', WITH_IQC_HEAD: 'IQC Head',
  DEPT_REVIEW: 'SCM / VD', IQC_HEAD_FINAL: 'IQC Head final', SENIOR_ESCALATION: 'Senior escalation', UNDER_DEVIATION: 'Awaiting quantities', QTY_VERIFICATION: 'Quantity check',
};
const ACTIONS = { UAI: 'Use as is', SEGREGATION: 'Segregation', REWORK: 'Rework' };

export const VIEWS = {
  'imir-register': {
    icon: FileText, tone: 'bg-blue-100 text-blue-600',
    kpis: (rows) => {
      const closed = rows.filter((r) => CLOSED.includes(r.status)).length;
      const dev = rows.filter((r) => r.deviationNo).length;
      return [
        { label: 'Total Lots', value: rows.length, note: 'in selected period', icon: FileText, tone: 'blue' },
        { label: 'Closed Lots', value: closed, note: pct(closed, rows.length), icon: CheckCircle2, tone: 'green' },
        { label: 'Open Lots', value: rows.length - closed, note: pct(rows.length - closed, rows.length), icon: Clock, tone: 'amber' },
        { label: 'Deviations', value: dev, note: pct(dev, rows.length), icon: AlertTriangle, tone: 'rose' },
        { label: 'Unique Items', value: distinct(rows, 'itemCode'), note: `${distinct(rows, 'vendorCode')} vendors`, icon: Boxes, tone: 'violet' },
      ];
    },
    charts: (rows) => {
      const byVendor = countBy(rows, 'vendorName');
      const top = byVendor.slice(0, 4);
      const rest = byVendor.slice(4).reduce((a, x) => a + x.value, 0);
      return [
        { title: 'Lot Status Trend', sub: 'Lots by GRN date, with the inspection result', kind: 'columns', granular: true,
          data: (gran) => bucketed(rows, 'grnDate', (r) => r.result ?? 'PENDING', gran),
          series: [{ key: 'OK', label: 'OK', color: C.green }, { key: 'NOK', label: 'Not OK', color: C.red }, { key: 'PENDING', label: 'Not inspected', color: C.slate }] },
        { title: 'Top Vendors by Lots', kind: 'rank', total: rows.length,
          rows: [...top, ...(rest ? [{ label: 'Other vendors', value: rest }] : [])].map((x) => ({ key: x.label, label: x.label, value: x.value })) },
        { title: 'Status Breakdown', kind: 'donut',
          segments: donut(countBy(rows, 'status', IMIR_GROUP), { Accepted: C.green, 'Accepted under deviation': C.teal, Rejected: C.red, 'Waiting for format': C.slate, 'To inspect / inspecting': C.blue, 'In review / decision': C.violet, 'Auto-closed': C.amber }) },
      ];
    },
    rowMenu: (r) => [
      r.imirId && { label: 'Open IMIR', icon: ExternalLink, to: `/imirs/${r.imirId}` },
      r.deviationId && { label: `Open ${r.deviationNo}`, icon: FileWarning, to: `/deviations/${r.deviationId}` },
      r.dnId && { label: `Open ${r.dnNo}`, icon: FileX2, to: `/dns/${r.dnId}` },
      r.itemId && { label: 'Item inspection format', icon: FileCheck2, to: `/formats/items/${r.itemId}` },
    ],
  },

  'pending-ageing': {
    icon: Hourglass, tone: 'bg-amber-100 text-amber-600',
    kpis: (rows) => [
      { label: 'Open Lots', value: rows.length, note: 'not closed yet', icon: Layers, tone: 'blue' },
      { label: 'Average Days Open', value: avg(rows, 'daysOpen'), note: 'since received', icon: Clock, tone: 'amber' },
      { label: 'Over 7 Days in Stage', value: rows.filter((r) => r.daysInStage > 7).length, note: pct(rows.filter((r) => r.daysInStage > 7).length, rows.length), icon: AlarmClock, tone: 'rose' },
      { label: 'Oldest Lot', value: `${Math.max(0, ...rows.map((r) => n(r.daysOpen)))} d`, note: 'days open', icon: Timer, tone: 'violet' },
      { label: 'Stages', value: distinct(rows, 'status'), note: `${distinct(rows, 'plant')} plant(s)`, icon: ClipboardList, tone: 'green' },
    ],
    charts: (rows) => [
      { title: 'Time in current stage', sub: 'How long lots have waited since their last step', kind: 'donut',
        segments: ['0-1 days', '2-3 days', '4-7 days', 'Over 7 days'].map((b, i) => ({ label: b, value: rows.filter((r) => r.bucket === b).length, color: [C.green, C.blue, C.amber, C.red][i] })) },
      { title: 'Open lots by stage', kind: 'bars', span: 2, rows: bars(countBy(rows, 'status', (s) => STAGE_NAMES[s] ?? words(s)), 'amber', 10, (x) => { const v = rows.filter((r) => (STAGE_NAMES[r.status] ?? words(r.status)) === x.label); return `oldest ${Math.max(...v.map((r) => n(r.daysInStage)))} d in this stage`; }) },
      { title: 'Open lots by plant', kind: 'bars', span: 3, rows: bars(countBy(rows, 'plant'), 'blue', 10) },
    ],
    rowMenu: (r) => [r.imirId && { label: 'Open IMIR', icon: ExternalLink, to: `/imirs/${r.imirId}` }],
  },

  'vendor-quality': {
    icon: Scale, tone: 'bg-rose-100 text-rose-600',
    kpis: (rows) => {
      const inspected = sum(rows, 'inspected');
      const nok = sum(rows, 'nokLots');
      const qty = sum(rows, 'inwardQty');
      const ppm = qty ? Math.round(rows.reduce((a, r) => a + n(r.rejectedPpm) * n(r.inwardQty), 0) / qty) : 0;
      return [
        { label: 'Vendors', value: rows.length, note: 'with lots in the period', icon: Users, tone: 'blue' },
        { label: 'Lots', value: sum(rows, 'lots'), note: `${inspected} inspected`, icon: Layers, tone: 'green' },
        { label: 'Not OK Rate', value: pct(nok, inspected), note: `${nok} lots not OK`, icon: Percent, tone: 'rose' },
        { label: 'Rejected PPM', value: ppm.toLocaleString('en-IN'), note: 'weighted by inward qty', icon: Gauge, tone: 'amber' },
        { label: 'DNs Raised', value: sum(rows, 'dns'), note: `${rows.filter((r) => r.dns > 0).length} vendors`, icon: FileX2, tone: 'violet' },
      ];
    },
    charts: (rows) => [
      { title: 'Not OK % by vendor', sub: 'Highest first (vendors with inspected lots)', kind: 'bars', span: 2, max: 100, format: (v) => `${v.toFixed(1)} %`,
        rows: rows.filter((r) => r.inspected > 0).sort((a, b) => b.nokPct - a.nokPct).slice(0, 10)
          .map((r) => ({ key: r.vendorCode, label: r.vendorName, value: n(r.nokPct), tone: r.nokPct >= 20 ? 'rose' : r.nokPct > 0 ? 'amber' : 'blue', note: `${r.nokLots} of ${r.inspected} lots not OK · ${r.rejected} rejected`, to: imirLink('vendorCode', r.vendorCode) })) },
      { title: 'How lots ended', kind: 'donut',
        segments: [
          { label: 'Accepted', value: sum(rows, 'accepted'), color: C.green }, { label: 'Under deviation', value: sum(rows, 'underDeviation'), color: C.teal },
          { label: 'Rejected', value: sum(rows, 'rejected'), color: C.red }, { label: 'Still open', value: Math.max(0, sum(rows, 'lots') - sum(rows, 'accepted') - sum(rows, 'underDeviation') - sum(rows, 'rejected')), color: C.slate },
        ] },
      { title: 'Rejected PPM by vendor', sub: 'Parts per million of inward quantity rejected', kind: 'bars', span: 3, format: (v) => v.toLocaleString('en-IN'),
        rows: rows.filter((r) => n(r.rejectedPpm) > 0).sort((a, b) => b.rejectedPpm - a.rejectedPpm).slice(0, 10).map((r) => ({ key: r.vendorCode, label: r.vendorName, value: n(r.rejectedPpm), tone: 'rose', note: `${n(r.inwardQty).toLocaleString('en-IN')} inward` })) },
    ],
    rowMenu: (r) => [{ label: 'Lots of this vendor', icon: PackageOpen, to: imirLink('vendorCode', r.vendorCode) }],
  },

  'item-quality': {
    icon: Boxes, tone: 'bg-sky-100 text-sky-600',
    kpis: (rows) => {
      const inspected = sum(rows, 'inspected');
      const nok = sum(rows, 'nokLots');
      return [
        { label: 'Items', value: rows.length, note: 'received in the period', icon: Boxes, tone: 'blue' },
        { label: 'Lots', value: sum(rows, 'lots'), note: `${inspected} inspected`, icon: Layers, tone: 'green' },
        { label: 'Not OK Rate', value: pct(nok, inspected), note: `${nok} lots not OK`, icon: Percent, tone: 'rose' },
        { label: 'Items with Deviations', value: rows.filter((r) => r.deviations > 0).length, note: `${sum(rows, 'deviations')} deviations · ${sum(rows, 'dns')} DNs`, icon: FileWarning, tone: 'amber' },
        { label: 'Without Format', value: rows.filter((r) => !r.formatVersion).length, note: 'no approved format', icon: FileText, tone: 'violet' },
      ];
    },
    charts: (rows) => [
      { title: 'Not OK % by item', sub: 'Items with inspected lots, highest first', kind: 'bars', span: 2, max: 100, format: (v) => `${v.toFixed(1)} %`,
        rows: rows.filter((r) => r.inspected > 0).sort((a, b) => b.nokPct - a.nokPct).slice(0, 10)
          .map((r) => ({ key: r.itemCode, label: `${r.itemCode} · ${r.itemDescription ?? ''}`, value: n(r.nokPct), tone: r.nokPct >= 20 ? 'rose' : r.nokPct > 0 ? 'amber' : 'blue', note: `${r.nokLots} of ${r.inspected} lots not OK · ${r.vendors} vendor(s)`, to: imirLink('itemCode', r.itemCode) })) },
      { title: 'Lots by category', kind: 'donut', segments: donut(rows.reduce((m, r) => { const k = r.category ?? 'No category'; const x = m.find((y) => y.label === k); if (x) x.value += n(r.lots); else m.push({ label: k, value: n(r.lots) }); return m; }, []).sort((a, b) => b.value - a.value)) },
      { title: 'Items by lots received', kind: 'rank', span: 3, total: sum(rows, 'lots'),
        rows: [...rows].sort((a, b) => b.lots - a.lots).slice(0, 8).map((r) => ({ key: r.itemCode, label: `${r.itemCode} ${r.itemDescription ?? ''}`, value: n(r.lots) })) },
    ],
    rowMenu: (r) => [
      { label: 'Lots of this item', icon: PackageOpen, to: imirLink('itemCode', r.itemCode) },
      r.itemId && { label: 'Item inspection format', icon: FileCheck2, to: `/formats/items/${r.itemId}` },
    ],
  },

  'deviation-register': {
    icon: FileWarning, tone: 'bg-orange-100 text-orange-600',
    kpis: (rows) => {
      const open = rows.filter((r) => r.stage !== 'CLOSED').length;
      return [
        { label: 'Deviations', value: rows.length, note: 'raised in the period', icon: FileWarning, tone: 'blue' },
        { label: 'Open', value: open, note: pct(open, rows.length), icon: Clock, tone: 'amber' },
        { label: 'Under Deviation', value: rows.filter((r) => r.outcome === 'ACCEPTED_UNDER_DEVIATION').length, note: pct(rows.filter((r) => r.outcome === 'ACCEPTED_UNDER_DEVIATION').length, rows.length), icon: CheckCircle2, tone: 'green' },
        { label: 'Rejected', value: rows.filter((r) => r.outcome === 'REJECTED').length, note: pct(rows.filter((r) => r.outcome === 'REJECTED').length, rows.length), icon: FileX2, tone: 'rose' },
        { label: 'Escalated', value: rows.filter((r) => n(r.escalationRounds) > 0).length, note: 'went to senior authority', icon: TrendingUp, tone: 'violet' },
      ];
    },
    charts: (rows) => [
      { title: 'Deviations raised', sub: 'By department', kind: 'columns', span: 2, granular: true, data: (gran) => bucketed(rows, 'createdAt', (r) => r.department ?? 'Other', gran),
        series: [{ key: 'SCM', label: 'SCM', color: C.blue }, { key: 'VD', label: 'VD', color: C.violet }, { key: 'Other', label: 'Other', color: C.slate }] },
      { title: 'Outcome', kind: 'donut', segments: donut(countBy(rows, 'outcome', (v) => (v ? words(v) : 'Open')), { Open: C.amber, 'Accepted under deviation': C.green, Rejected: C.red, 'Auto closed': C.slate }) },
      { title: 'Action taken', kind: 'bars', rows: bars(countBy(rows, 'action', (v) => ACTIONS[v] ?? 'Not chosen yet'), 'violet') },
      { title: 'Severity', kind: 'bars', rows: bars(countBy(rows, 'severity', (v) => words(v)), 'rose') },
      { title: 'Current stage', kind: 'donut', segments: donut(countBy(rows, 'stage', (v) => words(v))) },
    ],
    rowMenu: (r) => [
      r.deviationId && { label: 'Open deviation', icon: ExternalLink, to: `/deviations/${r.deviationId}` },
      r.imirId && { label: 'Open IMIR', icon: FileText, to: `/imirs/${r.imirId}` },
    ],
  },

  'dn-register': {
    icon: FileX2, tone: 'bg-rose-100 text-rose-600',
    kpis: (rows) => [
      { label: 'Defect Notifications', value: rows.length, note: 'raised in the period', icon: FileX2, tone: 'blue' },
      { label: 'CAPA Awaited', value: rows.filter((r) => r.status === 'OPEN').length, note: pct(rows.filter((r) => r.status === 'OPEN').length, rows.length), icon: Clock, tone: 'amber' },
      { label: 'CAPA Overdue', value: rows.filter((r) => r.capaOverdue).length, note: 'past the due date', icon: AlarmClock, tone: 'rose' },
      { label: 'Closed', value: rows.filter((r) => r.status === 'CLOSED').length, note: pct(rows.filter((r) => r.status === 'CLOSED').length, rows.length), icon: CheckCircle2, tone: 'green' },
      { label: 'Average Days Open', value: avg(rows, 'daysOpen'), note: `${sum(rows, 'capaCycles')} CAPA cycles`, icon: Timer, tone: 'violet' },
    ],
    charts: (rows) => [
      { title: 'DN status', kind: 'donut', segments: donut(countBy(rows, 'status', (v, r) => (r.capaOverdue ? 'CAPA overdue' : v === 'OPEN' ? 'CAPA awaited' : v === 'CAPA_SUBMITTED' ? 'With IQC Head' : 'Closed')), { 'CAPA overdue': C.red, 'CAPA awaited': C.amber, 'With IQC Head': C.violet, Closed: C.green }) },
      { title: 'DNs by vendor', kind: 'bars', span: 2, rows: bars(countBy(rows, 'vendorName'), 'rose', 10, (x) => `${rows.filter((r) => r.vendorName === x.label && r.status !== 'CLOSED').length} open`) },
      { title: 'Days open', kind: 'bars', span: 3,
        rows: [['0-3 days', (d) => d <= 3, 'blue'], ['4-7 days', (d) => d > 3 && d <= 7, 'amber'], ['8-30 days', (d) => d > 7 && d <= 30, 'amber'], ['Over 30 days', (d) => d > 30, 'rose']]
          .map(([label, f, tone]) => ({ key: label, label, value: rows.filter((r) => f(n(r.daysOpen))).length, tone })) },
    ],
    rowMenu: (r) => [
      r.dnId && { label: 'Open DN', icon: ExternalLink, to: `/dns/${r.dnId}` },
      r.imirId && { label: 'Open IMIR', icon: FileText, to: `/imirs/${r.imirId}` },
    ],
  },

  'format-coverage': {
    icon: FileCheck2, tone: 'bg-violet-100 text-violet-600',
    kpis: (rows) => {
      const ok = rows.filter((r) => r.coverage === 'Approved').length;
      return [
        { label: 'Items Received', value: rows.length, note: 'in the period', icon: Boxes, tone: 'blue' },
        { label: 'With Approved Format', value: ok, note: pct(ok, rows.length), icon: CheckCircle2, tone: 'green' },
        { label: 'Missing Format', value: rows.length - ok, note: pct(rows.length - ok, rows.length), icon: AlertTriangle, tone: 'rose' },
        { label: 'Drafts in Progress', value: rows.filter((r) => r.openDraft).length, note: 'being prepared', icon: FileText, tone: 'amber' },
        { label: 'Lots Waiting', value: sum(rows, 'waitingLots'), note: 'for a format', icon: Hourglass, tone: 'violet' },
      ];
    },
    charts: (rows) => [
      { title: 'Format coverage', kind: 'donut', segments: donut(countBy(rows, 'coverage'), { Approved: C.green, Missing: C.red }) },
      { title: 'Items with lots waiting', sub: 'Approve these formats first', kind: 'bars', span: 2,
        rows: rows.filter((r) => r.waitingLots > 0).sort((a, b) => b.waitingLots - a.waitingLots).slice(0, 10).map((r) => ({ key: r.itemCode, label: `${r.itemCode} · ${r.itemDescription ?? ''}`, value: n(r.waitingLots), tone: 'rose', note: r.openDraft ? `draft: ${r.openDraft}` : 'no draft yet', to: r.itemId ? `/formats/items/${r.itemId}` : undefined })) },
      { title: 'Missing formats by category', kind: 'bars', span: 3, rows: bars(countBy(rows.filter((r) => r.coverage !== 'Approved'), 'category', (v) => v ?? 'No category'), 'amber', 10) },
    ],
    rowMenu: (r) => [r.itemId && { label: 'Item inspection format', icon: ExternalLink, to: `/formats/items/${r.itemId}` }],
  },

  'measurement-drift': {
    icon: Activity, tone: 'bg-orange-100 text-orange-600',
    kpis: (rows) => {
      const of = (f) => rows.filter((r) => r.finding === f).length;
      return [
        { label: 'Flagged Check Points', value: rows.length, note: 'latest lot inspected in the period', icon: Activity, tone: 'blue' },
        { label: 'Close to Limit', value: of('Close to limit'), note: 'a reading uses 80 %+ of the tolerance', icon: AlertTriangle, tone: 'rose' },
        { label: 'Shift', value: of('Shift'), note: 'lot average far from the usual', icon: ArrowUpDown, tone: 'amber' },
        { label: 'Trend', value: of('Trend'), note: 'averages moving toward a limit', icon: TrendingUp, tone: 'violet' },
        { label: 'Items Affected', value: distinct(rows, 'itemCode'), note: `${distinct(rows, 'vendorName')} vendor(s)`, icon: Boxes, tone: 'green' },
      ];
    },
    charts: (rows) => [
      { title: 'Findings', sub: 'What the drift rules found', kind: 'donut',
        segments: donut(countBy(rows, 'finding'), { 'Close to limit': C.red, Shift: C.amber, Trend: C.violet }) },
      { title: 'Vendors with most findings', kind: 'bars', span: 2, rows: bars(countBy(rows, 'vendorName'), 'rose', 10) },
      { title: 'Items with most findings', kind: 'bars', span: 3,
        rows: bars(countBy(rows, 'itemCode', (v) => { const r = rows.find((x) => x.itemCode === v); return `${v} · ${r?.itemDescription ?? ''}`; }), 'amber', 10) },
    ],
    rowMenu: (r) => [
      r.imirId && { label: 'Open latest IMIR', icon: ExternalLink, to: `/imirs/${r.imirId}` },
      r.itemId && { label: 'Item inspection format', icon: FileCheck2, to: `/formats/items/${r.itemId}` },
    ],
  },

  tat: {
    icon: Timer, tone: 'bg-emerald-100 text-emerald-600',
    kpis: (rows) => {
      const slow = [...rows].filter((r) => r.medianHours !== null).sort((a, b) => b.medianHours - a.medianHours)[0];
      return [
        { label: 'Stages', value: rows.length, note: 'with lots in the period', icon: ClipboardList, tone: 'blue' },
        { label: 'Stage Passes', value: sum(rows, 'completed'), note: 'completed stage visits', icon: CheckCircle2, tone: 'green' },
        { label: 'Waiting Now', value: sum(rows, 'openNow'), note: 'lots in a stage now', icon: Hourglass, tone: 'amber' },
        { label: 'Slowest Stage', value: slow ? `${slow.medianHours} h` : '—', note: slow?.stage ?? 'median time', icon: Timer, tone: 'rose' },
        { label: 'Longest Wait Now', value: `${Math.max(0, ...rows.map((r) => n(r.oldestOpenHours)))} h`, note: 'oldest lot still waiting', icon: AlarmClock, tone: 'violet' },
      ];
    },
    charts: (rows) => [
      { title: 'Median hours per stage', sub: 'Half of the lots pass the stage faster than this', kind: 'bars', span: 2, format: (v) => `${v} h`,
        rows: rows.filter((r) => r.completed > 0).map((r) => ({ key: r.stage, label: r.stage, value: n(r.medianHours), tone: 'blue', note: `average ${r.avgHours ?? '—'} h · 90% within ${r.p90Hours ?? '—'} h` })) },
      { title: 'Lots waiting now', kind: 'donut', segments: donut(rows.filter((r) => r.openNow > 0).map((r) => ({ label: r.stage, value: n(r.openNow) }))) },
    ],
    rowMenu: () => [],
  },
};
