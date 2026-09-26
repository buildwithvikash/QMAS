import { Gauge, LineChart, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetInsightsOverviewQuery } from '../../api/aiApi.js';
import Badge from '../../components/ui/Badge.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { formatDate } from '../../utils/format.js';

const LEVEL = { LOW: ['Low', 'success'], MEDIUM: ['Medium', 'warning'], HIGH: ['High', 'danger'], NEW: ['New', 'neutral'] };
const REC = { REDUCED: 'Reduced', NORMAL: 'Normal', TIGHTENED: 'Tightened' };
const DRIFT = { NEAR_LIMIT: ['Near limit', 'warning'], SHIFT: ['Shifted', 'warning'], TREND: ['Drifting', 'danger'] };
const lotsOf = (vendorCode) => `/imirs?filter=${encodeURIComponent(JSON.stringify({ mode: 'all', rules: [{ field: 'vendorCode', op: 'equals', value: vendorCode }] }))}`;

/** Lot averages of a characteristic as a small line, with its limits as dashed lines. */
function Spark({ means, lsl, usl }) {
  const vals = means.filter((v) => v !== null);
  if (vals.length < 2) return null;
  const all = [...vals, lsl, usl].filter((v) => v !== null && v !== undefined);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const w = 120;
  const h = 32;
  const y = (v) => (hi === lo ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6));
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * (w - 6) + 3},${y(v)}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden="true">
      {[lsl, usl].filter((v) => v !== null && v !== undefined).map((l) => <line key={l} x1="0" x2={w} y1={y(l)} y2={y(l)} stroke="#f43f5e" strokeDasharray="3 3" strokeWidth="1" />)}
      <polyline points={pts} fill="none" stroke="#0067b8" strokeWidth="1.8" />
      <circle cx={w - 3} cy={y(vals.at(-1))} r="2.5" fill="#0067b8" />
    </svg>
  );
}

/**
 * Quality insights for Incharge and above, from inspection history (no AI): which suppliers carry
 * the most risk and what inspection level suits them, which open lots are most likely to fail, and
 * which measured characteristics are drifting.
 */
export default function InsightsPage() {
  const { data: o, isLoading, error } = useGetInsightsOverviewQuery(undefined, { refetchOnMountOrArgChange: 300 });
  return (
    <div>
      <PageHeader icon={LineChart} title="Quality insights" subtitle={o ? `From inspection history: supplier risk over ${o.windowDays} days, failure chance of open lots, drifting measurements` : 'From inspection history'} />
      <div className="p-4 sm:p-5 space-y-4">
        {isLoading && <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-32" />)}</div>}
        {error && <p className="text-sm text-rose-700">{apiError(error).message}</p>}
        {o && (
          <>
            <section className="card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                <ShieldAlert className="w-4 h-4 text-blue-700" />
                <h2 className="text-sm font-semibold text-slate-900">Supplier risk</h2>
                <span className="text-xs text-slate-500">Not-OK rate (pulled toward the plant average of {Math.round(o.baseRate * 100)} % while history is short), major deviations, DNs and repeat defects</span>
              </div>
              {o.vendors.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No inspected lots in the period.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>{['Vendor', 'Risk', 'Score', 'Lots', 'Not OK', 'Inspection', 'Why'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {o.vendors.map((v) => (
                        <tr key={v.vendorCode} className="hover:bg-slate-50">
                          <td className="px-3 py-2"><Link to={lotsOf(v.vendorCode)} className="font-medium text-slate-900 hover:text-blue-700">{v.vendorName}</Link><span className="block text-xs text-slate-400 font-mono">{v.vendorCode}</span></td>
                          <td className="px-3 py-2"><Badge variant={LEVEL[v.level][1]}>{LEVEL[v.level][0]}</Badge></td>
                          <td className="px-3 py-2 w-32">
                            <div className="flex items-center gap-2"><div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full ${v.score >= 35 ? 'bg-rose-500' : v.score >= 15 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${v.score}%` }} /></div><span className="tabular text-xs">{v.score}</span></div>
                          </td>
                          <td className="px-3 py-2 tabular">{v.lots}</td>
                          <td className="px-3 py-2 tabular">{v.nok}{v.nokRate !== null && <span className="text-xs text-slate-400"> ({Math.round(v.nokRate * 100)} %)</span>}</td>
                          <td className="px-3 py-2 whitespace-nowrap"><span className={v.recommendation === 'TIGHTENED' ? 'font-semibold text-rose-700' : v.recommendation === 'REDUCED' ? 'font-semibold text-emerald-700' : 'text-slate-700'}>{REC[v.recommendation]}</span></td>
                          <td className="px-3 py-2 text-xs text-slate-500 min-w-56">{v.reasons.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                  <Gauge className="w-4 h-4 text-rose-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Open lots most likely to fail</h2>
                </div>
                {o.openLots.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No lots waiting for inspection.</p> : (
                  <ul className="divide-y divide-slate-100">
                    {o.openLots.map((l) => (
                      <li key={l.id}>
                        <Link to={`/imirs/${l.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm"><span className="font-mono text-xs text-slate-500">{l.imirNo ?? 'Waiting for format'}</span> <span className="font-medium text-slate-900">{l.itemCode}</span> <span className="text-slate-500">{l.itemDescription}</span></p>
                            <p className="text-xs text-slate-500 truncate">{l.vendorName} · {l.plantName ?? l.plantSapCode} · received {formatDate(l.createdAt)}</p>
                          </div>
                          <div className="w-24 shrink-0">
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full ${l.level === 'HIGH' ? 'bg-rose-500' : l.level === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.round(l.probability * 100)}%` }} /></div>
                            <p className={`text-right text-xs font-semibold tabular ${l.level === 'HIGH' ? 'text-rose-700' : l.level === 'MEDIUM' ? 'text-amber-700' : 'text-emerald-700'}`}>{Math.round(l.probability * 100)} %</p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                  <LineChart className="w-4 h-4 text-amber-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Drifting measurements</h2>
                  <span className="text-xs text-slate-500">latest lot against the ones before</span>
                </div>
                {o.drift.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No measurement is drifting in recent lots.</p> : (
                  <ul className="divide-y divide-slate-100">
                    {o.drift.map((d) => (
                      <li key={`${d.imirId}-${d.checkpoint}`}>
                        <Link to={`/imirs/${d.imirId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm"><span className="font-semibold text-slate-900">{d.checkpoint}</span> <Badge variant={DRIFT[d.status][1]}>{DRIFT[d.status][0]}</Badge> <span className="text-slate-500">{d.itemCode} · {d.vendorName}</span></p>
                            <p className="text-xs text-slate-600">{d.message}</p>
                            <p className="text-[11px] text-slate-400 font-mono">{d.imirNo} · {formatDate(d.at)}</p>
                          </div>
                          <Spark means={d.means} lsl={d.lsl} usl={d.usl} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
