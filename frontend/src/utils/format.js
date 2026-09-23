// All dates are shown in IST, whatever the device's time zone.
const TZ = 'Asia/Kolkata';
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (v) => (v ? dateTimeFmt.format(new Date(v)) : '—');
export const formatDate = (v) => (v ? dateFmt.format(new Date(v)) : '—');

/** "3 min ago" style, falling back to a date after a week. */
export function formatRelative(v) {
  if (!v) return '—';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return formatDate(v);
}

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'U';

/** Quantity with unit, Indian digit grouping, up to 3 decimals. */
export const formatQty = (v, uom) => `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${uom ?? ''}`.trim();
