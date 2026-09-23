import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-200',
  secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-200',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200',
};
const SIZES = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-3 text-sm gap-2', // tablet / sign-in: 44 px touch target
};

/** Button with WRL styling. `loading` disables it and shows a spinner, so double submits cannot happen. */
export default function Button({ variant = 'primary', size = 'md', icon: Icon, loading = false, className = '', children, type = 'button', ...props }) {
  return (
    <button
      type={type}
      disabled={loading || props.disabled}
      className={`inline-flex items-center justify-center font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}
