import { ClipboardCheck, FileSpreadsheet, FileWarning, FileX2, ScanSearch } from 'lucide-react';

/** The kinds of work on the dashboard, in the order a lot moves through them. */
export const KINDS = [
  { key: 'inspect', label: 'Inspect', long: 'Lots to inspect', icon: ScanSearch, verb: 'Inspect' },
  { key: 'review', label: 'Review', long: 'Inspections to review', icon: ClipboardCheck, verb: 'Review' },
  { key: 'deviation', label: 'Deviations', long: 'Deviations at your step', icon: FileWarning, verb: 'Open' },
  { key: 'capa', label: 'DN / CAPA', long: 'Defect notifications', icon: FileX2, verb: 'Open' },
  { key: 'format', label: 'Formats', long: 'Inspection formats', icon: FileSpreadsheet, verb: 'Open' },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k]));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How urgent a task is: past its deadline (overdue), due within a day (due), or, without a
 * deadline, waiting over 3 days (stale) or over a day (waiting). rank sorts the list: 0 first.
 */
export function urgencyOf(t, now = Date.now()) {
  if (t.dueAt) {
    const left = new Date(t.dueAt).getTime() - now;
    if (left < 0) return { level: 'overdue', rank: 0 };
    if (left < DAY) return { level: 'due', rank: 1 };
  }
  if (t.sentBack) return { level: 'due', rank: 1 };
  const waited = now - new Date(t.since).getTime();
  if (waited > 3 * DAY) return { level: 'stale', rank: 2 };
  if (waited > DAY) return { level: 'waiting', rank: 3 };
  return { level: 'fresh', rank: 4 };
}

/** Most urgent first; equally urgent tasks oldest first. */
export const byUrgency = (a, b) => urgencyOf(a).rank - urgencyOf(b).rank || new Date(a.since) - new Date(b.since);

/** Counts per kind: { total, urgent } where urgent = overdue, due within a day or sent back. */
export function countsByKind(tasks) {
  const out = Object.fromEntries(KINDS.map((k) => [k.key, { total: 0, urgent: 0 }]));
  for (const t of tasks) {
    const c = out[t.kind];
    if (!c) continue;
    c.total += 1;
    if (urgencyOf(t).rank <= 1) c.urgent += 1;
  }
  return out;
}
