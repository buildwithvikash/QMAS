/**
 * Rounds of every send-back loop, worked out from the lot's workflow history, so each loop is
 * numbered the way senior escalation is (Round 1, Round 2, …).
 *
 * A round starts with a submission; it ends when it is sent back (a new round follows) or moved on.
 * Loops: inspection (submit ↔ Incharge sends back), Deviation Form (submit ↔ Sub-Head/Head sends
 * back, or seniors ask for another type), quantities (enter ↔ IQC Head returns), CAPA (submit ↔
 * IQC Head asks to resubmit), senior escalation (escalate → result).
 */
export const LOOPS = {
  inspection: { title: 'Inspection rounds', start: ['SUBMIT'], back: ['REVERT'], ahead: ['APPROVE', 'ESCALATE'], deviation: false },
  form: {
    title: 'Deviation Form rounds',
    start: ['SUBMIT_FORM', 'RECOMMEND_REJECT'],
    back: ['SEND_BACK'],
    ahead: ['DEPT_APPROVE', 'DEPT_REJECT'],
    // A change of type by the seniors sends the form back too.
    isBack: (h) => h.action === 'SENIOR_RESULT' && h.payload?.decision === 'CHANGE_TYPE',
  },
  qty: { title: 'Quantity rounds', start: ['ENTER_QTY'], back: ['RETURN_QTY'], ahead: ['VERIFY_QTY'] },
  capa: { title: 'CAPA rounds', start: ['DN_SUBMIT_CAPA'], back: ['DN_RESUBMIT'], ahead: ['DN_CLOSE'] },
  escalation: { title: 'Escalation rounds', start: ['ESCALATE'], back: [], ahead: ['SENIOR_RESULT'], onlyDeviation: true },
};

/**
 * [{ no, start (the submitting step), events (decisions on it, oldest first), outcome: 'back' | 'ahead' | 'open', end }]
 * oldest first. `loop` is a key of LOOPS.
 */
export function roundsOf(history = [], loop) {
  const L = LOOPS[loop];
  const rounds = [];
  const sorted = [...history].sort((a, b) => new Date(a.at) - new Date(b.at) || a.id - b.id);
  for (const h of sorted) {
    if (L.start.includes(h.action)) {
      if (L.onlyDeviation && !h.deviationId) continue;
      if (loop === 'inspection' && h.deviationId) continue;
      rounds.push({ no: rounds.length + 1, start: h, events: [], outcome: 'open', end: null });
      continue;
    }
    const cur = rounds.at(-1);
    if (!cur || cur.outcome === 'back') continue; // a sent-back round is finished
    if (loop === 'inspection' && h.deviationId) continue; // the deviation's own escalation is not the inspection's
    const back = L.back.includes(h.action) || L.isBack?.(h);
    const ahead = L.ahead.includes(h.action);
    if (!back && !ahead) continue;
    cur.events.push(h);
    if (back) {
      cur.outcome = 'back';
      cur.end = h;
    } else {
      // Several approvers may move it on (Sub-Head, then Head): the last one counts.
      cur.outcome = 'ahead';
      cur.end = h;
    }
  }
  return rounds;
}

/** Round number of each step in any loop, for badges in the History panel: step id → { loop, no, role }. */
export function roundBadges(history = []) {
  const out = new Map();
  for (const loop of Object.keys(LOOPS)) {
    const rs = roundsOf(history, loop);
    if (rs.length < 2 && !rs.some((r) => r.outcome === 'back')) continue; // a single, uneventful round needs no number
    for (const r of rs) {
      out.set(r.start.id, { loop, no: r.no, role: 'start' });
      for (const e of r.events) if (!out.has(e.id)) out.set(e.id, { loop, no: r.no, role: e === r.end && r.outcome === 'back' ? 'back' : 'decision' });
    }
  }
  return out;
}
