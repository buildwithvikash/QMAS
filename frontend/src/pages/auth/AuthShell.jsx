import { BarChart3, BellRing, ClipboardCheck, Database, Factory, Settings2, ShieldCheck, UserCheck } from 'lucide-react';
import { useEffect } from 'react';
import bg from '../../assets/login-bg.avif';
import logo from '../../assets/logo.png';

const FEATURES = [
  { icon: ClipboardCheck, tone: 'bg-emerald-500', title: 'Inspection Management', text: 'Create, review and approve formats' },
  { icon: BellRing, tone: 'bg-blue-500', title: 'Deviation Tracking', text: 'Track and raise notifications' },
  { icon: Settings2, tone: 'bg-amber-500', title: 'CAPA Management', text: 'Handle corrective and preventive actions' },
  { icon: BarChart3, tone: 'bg-violet-500', title: 'Reports & Insights', text: 'Get real-time status and analytics' },
];

const STRIP = [
  { icon: Factory, top: 'Multiple', bottom: 'Plants' },
  { icon: Database, top: 'Real-time', bottom: 'Tracking' },
  { icon: ShieldCheck, top: 'Audit', bottom: 'Ready' },
  { icon: UserCheck, top: 'Better', bottom: 'Quality' },
];

/**
 * The sign-in frame (sign in, forgot / reset password): the plant photo across the whole screen under a
 * blue wash, the product story on the left (large screens) and a frosted card on the right.
 */
export default function AuthShell({ title, subtitle, children }) {
  // The sign-in pages keep their photo design: never dark (also after a redirect from an app page).
  useEffect(() => document.documentElement.classList.remove('dark'), []);
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-900 text-slate-800">
      <div className="absolute inset-0 scale-110 bg-cover bg-center blur-[2px]" style={{ backgroundImage: `url(${bg})` }} aria-hidden="true" />
      <div className="absolute inset-0 bg-linear-to-r from-blue-950/95 via-blue-900/80 to-sky-700/40" aria-hidden="true" />
      <div className="absolute inset-0 bg-linear-to-t from-blue-950/60 via-transparent to-blue-950/30" aria-hidden="true" />

      <div className="relative flex min-h-screen w-full items-center justify-between gap-16 px-4 py-8 sm:px-8 lg:px-12 xl:pl-16 xl:pr-24 2xl:pl-24 2xl:pr-32">
        <section className="hidden flex-1 flex-col text-white lg:flex">
          <img src={logo} alt="Western Refrigeration and Hoshizaki" className="h-16 w-auto self-start drop-shadow" />
          <p className="mt-6 text-sm font-medium uppercase tracking-[0.3em] text-blue-100/90">Western Refrigeration Pvt. Ltd.</p>
          <h1 className="mt-3 text-7xl font-bold tracking-tight">QMAS</h1>
          <p className="mt-3 text-3xl font-semibold leading-tight">Incoming Material Inspection<br />&amp; Defect Notification</p>
          <p className="mt-4 max-w-md text-lg leading-snug text-blue-50/90">A single platform for inspection, deviation and CAPA management across all plants.</p>

          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-center gap-4">
                <span className={`grid h-13 w-13 shrink-0 place-items-center rounded-xl ${f.tone} shadow-lg shadow-black/20`}>
                  <f.icon className="h-6 w-6 text-white" />
                </span>
                <span>
                  <span className="block text-lg font-semibold">{f.title}</span>
                  <span className="block text-sm text-blue-50/85">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex max-w-2xl items-center divide-x divide-white/25 rounded-2xl border border-white/15 bg-white/10 py-5 backdrop-blur-md">
            {STRIP.map((s) => (
              <div key={s.top} className="flex flex-1 items-center justify-center gap-2.5 px-3">
                <s.icon className="h-8 w-8 shrink-0 text-white" strokeWidth={1.75} />
                <span className="whitespace-nowrap text-sm leading-tight text-white/95">{s.top}<br />{s.bottom}</span>
              </div>
            ))}
          </div>
        </section>

        <main className="mx-auto w-full max-w-lg lg:mx-0 lg:w-136 lg:max-w-none lg:shrink-0">
          <div className="rounded-3xl border border-white/70 bg-white/95 px-6 py-9 shadow-2xl shadow-blue-950/40 backdrop-blur-xl sm:px-12">
            <div className="mb-8 flex flex-col items-center text-center">
              <img src={logo} alt="Western Refrigeration and Hoshizaki" className="mb-4 h-16 w-auto" />
              <h2 className="text-3xl font-bold tracking-tight text-blue-950">{title}</h2>
              {subtitle && <p className="mt-1.5 text-base text-slate-500 text-balance">{subtitle}</p>}
            </div>
            {children}
            <div className="mt-8 flex items-center justify-center gap-3 text-left">
              <ShieldCheck className="h-9 w-9 shrink-0 text-slate-400" strokeWidth={1.5} />
              <span className="leading-tight">
                <span className="block text-sm text-slate-600">Your data is secure and protected</span>
                <span className="block text-xs text-slate-500">Protected with enterprise security standards</span>
              </span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
