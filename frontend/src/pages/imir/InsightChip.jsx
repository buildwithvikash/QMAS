import { History, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { formatDate } from '../../utils/format.js';

const DRIFT = {
  NEAR_LIMIT: 'Near limit',
  SHIFT: 'Shifted',
  TREND: 'Drifting',
};

/**
 * Under a checkpoint's name on the inspection sheet: how often it failed recently (with the last
 * failure in the tooltip), whether its values are drifting, and whether it is one of the places
 * to look first. `ins` is the checkpoint's entry from the lot insights.
 */
export default function InsightChip({ ins, focus }) {
  if (!ins) return null;
  const chips = [];
  if (focus) {
    chips.push(
      <span key="focus" className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800" title={`Look here first: ${focus.reasons.join(', ')}`}>
        <Target className="w-3 h-3" />Focus
      </span>,
    );
  }
  if (ins.recentFails > 0) {
    const last = ins.lastFail;
    const tip = [`Failed in ${ins.recentFails} of the last ${ins.recentLots} lots of this item`, ins.sameVendorFails ? `${ins.sameVendorFails} with this vendor` : null,
      last ? `last: ${last.imirNo} on ${formatDate(last.at)}${last.values?.length ? ` (${last.values.join(', ')})` : ''}${last.observation ? ` "${last.observation}"` : ''}` : null].filter(Boolean).join('; ');
    chips.push(
      <span key="hist" className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${ins.recentFails >= 2 || ins.failedLastLot ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'}`} title={tip}>
        <History className="w-3 h-3" />Failed {ins.recentFails}/{ins.recentLots}
      </span>,
    );
  }
  const d = ins.drift;
  if (d && DRIFT[d.status]) {
    const Icon = d.direction === 'DOWN' ? TrendingDown : TrendingUp;
    chips.push(
      <span key="drift" className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900" title={d.message}>
        <Icon className="w-3 h-3" />{DRIFT[d.status]}
      </span>,
    );
  }
  return chips.length ? <div className="mt-1 flex flex-wrap gap-1">{chips}</div> : null;
}
