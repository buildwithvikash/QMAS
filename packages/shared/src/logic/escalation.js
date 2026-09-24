import { ESCALATION_RANKS, ROLES } from '../constants/roles.js';

/**
 * Senior escalation (blueprint slide 11, Decision 5 and round-2 answers).
 * Selected authorities decide in parallel. Every decision is kept; the effective one is resolved:
 *
 *  Rule 1  the highest-ranked authority that has decided wins, overruling lower ones;
 *  Rule 2  if CQA Head and PDC Head are both in the round, CQA decides, but the result is final only
 *          once PDC has recorded its decision;
 *  Rule 3  if the Central Operations Head has not decided within 24 calendar hours, that step times
 *          out and CQA Head is added if missing (handled by `applyTimeouts`);
 *  Rule 4  CQA Head, Central Operations Head (and System Admin) may override while the deviation is
 *          open: the latest override is final.
 *
 * The round is complete when the highest-ranked active authority has decided (and Rule 2 holds);
 * lower authorities still pending are then not required.
 */
export const OPS_TIMEOUT_HOURS = 24;
export const SENIOR_DECISIONS = Object.freeze(['APPROVE', 'REJECT', 'CHANGE_TYPE']);

const RANK = Object.fromEntries(ESCALATION_RANKS.map((r) => [r.roleCode, r.rank]));
export const rankOf = (roleCode) => RANK[roleCode] ?? 0;

/**
 * steps:     [{ roleCode, status: PENDING | DECIDED | TIMED_OUT | NOT_REQUIRED }]
 * decisions: [{ roleCode, decision, kind: NORMAL | OVERRIDE, decidedAt }]  (append-only history)
 * Returns { effective, complete, decidedBy, pendingPdc, overridden, notRequired: [roleCode] }.
 */
export function resolveEscalation({ steps, decisions }) {
  const byTime = [...decisions].sort((a, b) => new Date(a.decidedAt) - new Date(b.decidedAt));
  const override = byTime.filter((d) => d.kind === 'OVERRIDE').at(-1);
  if (override) {
    return { effective: override.decision, complete: true, decidedBy: override.roleCode, pendingPdc: false, overridden: true, notRequired: pendingRoles(steps) };
  }

  const latest = new Map();
  for (const d of byTime) if (d.kind !== 'OVERRIDE') latest.set(d.roleCode, d);

  const active = steps.filter((s) => s.status !== 'TIMED_OUT' && s.status !== 'NOT_REQUIRED').sort((a, b) => rankOf(b.roleCode) - rankOf(a.roleCode));
  const topDecided = active.find((s) => latest.has(s.roleCode));
  const highest = active[0];
  const effective = topDecided ? latest.get(topDecided.roleCode).decision : null;

  const pdcActive = active.some((s) => s.roleCode === ROLES.PDC_HEAD);
  const pendingPdc = topDecided?.roleCode === ROLES.CQA_HEAD && pdcActive && !latest.has(ROLES.PDC_HEAD);
  const complete = !!highest && latest.has(highest.roleCode) && !pendingPdc;

  return {
    effective,
    complete,
    decidedBy: topDecided?.roleCode ?? null,
    pendingPdc,
    overridden: false,
    notRequired: complete ? active.filter((s) => !latest.has(s.roleCode)).map((s) => s.roleCode) : [],
  };
}

const pendingRoles = (steps) => steps.filter((s) => s.status === 'PENDING').map((s) => s.roleCode);

/**
 * Rule 3: returns what to change for the Central Operations Head step when its 24 hours have passed
 * without a decision: { timedOut: [roleCode], add: [roleCode] }.
 */
export function applyTimeouts({ steps, decisions, now = new Date() }) {
  const decided = new Set(decisions.filter((d) => d.kind !== 'OVERRIDE').map((d) => d.roleCode));
  const ops = steps.find((s) => s.roleCode === ROLES.CENTRAL_OPS_HEAD && s.status === 'PENDING' && !decided.has(s.roleCode));
  if (!ops || !ops.dueAt || new Date(ops.dueAt) > now) return { timedOut: [], add: [] };
  const hasCqa = steps.some((s) => s.roleCode === ROLES.CQA_HEAD && s.status !== 'NOT_REQUIRED');
  return { timedOut: [ROLES.CENTRAL_OPS_HEAD], add: hasCqa ? [] : [ROLES.CQA_HEAD] };
}
