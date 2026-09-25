import { CornerUpLeft, Hourglass, MoveRight } from 'lucide-react';
import { formatDateTime } from '../../utils/format.js';
import { HISTORY_LABELS, stepDetail } from './historyFormat.js';
import { LOOPS, roundsOf } from './rounds.js';

const who = (h) => (h.actorName ? `${h.actorName}${h.actingRoleName ? `, ${h.actingRoleName}` : ''}` : 'System');

/**
 * One send-back loop as numbered rounds, latest first, like the escalation board: what was
 * submitted in each round and how it ended (sent back with the reason, moved on, or waiting).
 * Shown once a loop has had a send-back. `detail(round)` adds loop-specific content (e.g. what
 * changed in the Deviation Form since the previous round).
 */
export default function RoundsPanel({ history, loop, detail, waitingFor }) {
  const rounds = roundsOf(history, loop);
  if (!rounds.some((r) => r.outcome === 'back')) return null;
  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="section-title">{LOOPS[loop].title}</h2>
        <span className="text-xs text-slate-500">{rounds.length} rounds, {rounds.filter((r) => r.outcome === 'back').length} sent back</span>
      </div>
      <ol className="space-y-2.5">
        {[...rounds].reverse().map((r) => {
          const tone = r.outcome === 'back' ? 'border-amber-300' : r.outcome === 'ahead' ? 'border-emerald-300' : 'border-blue-300';
          const extra = detail?.(r);
          const startDetail = stepDetail(r.start);
          return (
            <li key={r.start.id} className={`rounded-lg border border-slate-200 border-l-4 ${tone} p-3`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold text-slate-900">Round {r.no}</span>
                <span className="text-xs text-slate-500">{HISTORY_LABELS[r.start.action] ?? r.start.action} ({who(r.start)}), {formatDateTime(r.start.at)}</span>
              </div>
              {startDetail && <p className="text-xs text-slate-600 mt-0.5">{startDetail}</p>}
              {r.start.remark && <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{r.start.remark}</p>}
              {extra}
              {r.outcome === 'back' && (
                <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                    <CornerUpLeft className="w-3.5 h-3.5" />{HISTORY_LABELS[r.end.action] ?? r.end.action} ({who(r.end)}), {formatDateTime(r.end.at)}
                  </p>
                  {(r.end.remark || stepDetail(r.end)) && <p className="mt-0.5 text-sm text-amber-950 whitespace-pre-line">{r.end.remark ?? stepDetail(r.end)}</p>}
                </div>
              )}
              {r.outcome === 'ahead' && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-800">
                  <MoveRight className="w-3.5 h-3.5" />{r.events.map((e) => `${HISTORY_LABELS[e.action] ?? e.action} (${who(e)})`).join(', then ')}
                </p>
              )}
              {r.outcome === 'open' && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-blue-800"><Hourglass className="w-3.5 h-3.5" />{waitingFor ?? 'Waiting for a decision'}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
