const VARIANTS = {
  success: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  warning: 'bg-amber-50 text-amber-800 border-amber-300',
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  danger: 'bg-rose-50 text-rose-800 border-rose-300',
  neutral: 'bg-slate-100 text-slate-700 border-slate-300',
  primary: 'bg-blue-600 text-white border-blue-600',
};
const DOTS = {
  success: 'bg-emerald-500', warning: 'bg-amber-500', info: 'bg-blue-500', danger: 'bg-rose-500', neutral: 'bg-slate-400', primary: 'bg-white',
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
