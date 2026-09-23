const VARIANTS = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  primary: 'bg-blue-50 text-blue-700 border-blue-200',
};
const DOTS = {
  success: 'bg-emerald-500', warning: 'bg-amber-500', info: 'bg-sky-500', danger: 'bg-rose-500', neutral: 'bg-slate-400', primary: 'bg-blue-500',
};

/** Status pill: colour plus a dot and text, so state never depends on colour alone. */
export default function Badge({ variant = 'neutral', children, dot = true }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full border ${VARIANTS[variant]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${DOTS[variant]}`} />}
      {children}
    </span>
  );
}

export const ActiveBadge = ({ active }) => <Badge variant={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge>;
