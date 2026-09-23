import { Loader2 } from 'lucide-react';

export default function Loader({ label = 'Loading…', fullScreen = false }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-sm text-slate-500 ${fullScreen ? 'h-screen' : 'py-16'}`}>
      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
      {label}
    </div>
  );
}
