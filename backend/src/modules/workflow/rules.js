import { PERMISSIONS, rankOf, ROLES } from '@qmas/shared';

/**
 * Who may take which workflow action. One place for the rules, used to authorize each action,
 * to build `allowedActions` for the screens and to fill the My Tasks inbox.
 */

const P = PERMISSIONS;

/**
 * The role through which a user may act: an assignment holding `permission` (and, if given, one of
 * `roles`) whose action scope covers the plant. Returns the role code, or null.
 * System Admin stands in for any role (SCM / VD initiator and approvers, senior authorities), as
 * long as the admin role holds the permission; history records the action as System Admin's.
 */
export function actingRole(user, { permission, roles = null, plantId }) {
  for (const a of user.assignments) {
    if (roles && !roles.includes(a.roleCode) && a.roleCode !== ROLES.SYSTEM_ADMIN) continue;
    if (!a.permissions.includes(permission)) continue;
    if (a.actionScope === 'ALL' || a.plantId === null || a.plantId === plantId) return a.roleCode;
  }
  return null;
}

// ── IMIR review (Incharge, IQC Head) ──────────────────────────────────────────

export const IMIR_REVIEW_ACTIONS = Object.freeze({
  approve: { from: 'SUBMITTED', permission: P.IMIR_REVIEW, to: 'CLOSED_ACCEPTED' },
  revert: { from: 'SUBMITTED', permission: P.IMIR_REVIEW, to: 'IN_INSPECTION' },
  escalate: { from: 'SUBMITTED', permission: P.IMIR_REVIEW, to: 'WITH_IQC_HEAD' },
  head_approve: { from: 'WITH_IQC_HEAD', permission: P.IMIR_HEAD_DECIDE, to: 'CLOSED_ACCEPTED' },
  hold: { from: 'WITH_IQC_HEAD', permission: P.IMIR_HEAD_DECIDE, to: 'DEPT_REVIEW' },
});

/** Why an allowed-by-role review action cannot be taken, or null. */
export function imirReviewBlock(imir, action) {
  if (action === 'approve' && imir.result !== 'OK') return 'Only a lot that passed inspection can be approved. Escalate a failed lot to the IQC Head.';
  return null;
}

export function imirReviewActions(user, imir) {
  return Object.entries(IMIR_REVIEW_ACTIONS)
    .filter(([action, r]) => r.from === imir.status && actingRole(user, { permission: r.permission, plantId: imir.plantId }) && !imirReviewBlock(imir, action))
    .map(([action]) => action);
}

// ── Deviation ─────────────────────────────────────────────────────────────────

export const STAGE_ACTIONS = Object.freeze({
  INITIATOR: ['submit_form', 'recommend_reject'],
  SUB_HEAD: ['dept_approve', 'send_back', 'dept_reject'],
  HEAD: ['dept_approve', 'send_back', 'dept_reject'],
  FINAL: ['final_approve', 'final_reject', 'escalate', 'override'],
  SENIOR: ['senior_decide', 'override'],
  UNDER_DEVIATION: ['enter_qty'],
  QTY_VERIFICATION: ['verify_qty', 'return_qty'],
  CLOSED: [],
});

const SENIOR_FINAL = ['APPROVE', 'REJECT'];

/** Senior roles the user may decide as in the open round, highest first. */
export function seniorRoles(user, dev, round) {
  if (!round || round.status !== 'OPEN') return [];
  return round.steps
    .filter((s) => (s.status === 'PENDING' || s.status === 'DECIDED') && actingRole(user, { permission: P.ESCALATION_DECIDE, roles: [s.roleCode], plantId: dev.plantId }))
    .map((s) => s.roleCode)
    .sort((a, b) => rankOf(b) - rankOf(a));
}

/** The role the user acts in for `action` on this deviation, or null if they may not. */
export function deviationRole(user, dev, action, round) {
  const { department: dept, plantId } = dev;
  switch (action) {
    case 'submit_form':
    case 'recommend_reject':
    case 'enter_qty':
      return actingRole(user, { permission: P.DEVIATION_INITIATE, roles: [`${dept}_REQUESTOR`], plantId });
    case 'dept_approve':
    case 'send_back':
    case 'dept_reject':
      return actingRole(user, { permission: P.DEVIATION_APPROVE, roles: [`${dept}_${dev.stage}`], plantId });
    case 'final_approve':
    case 'final_reject':
    case 'escalate':
    case 'verify_qty':
    case 'return_qty':
      return actingRole(user, { permission: P.DEVIATION_FINAL_DECIDE, plantId });
    case 'senior_decide':
      return seniorRoles(user, dev, round)[0] ?? null;
    case 'override':
      return actingRole(user, { permission: P.ESCALATION_OVERRIDE, plantId });
    default:
      return null;
  }
}

/** Why an action the user's role allows cannot be taken now, or null. */
export function deviationBlock(dev, action) {
  const senior = dev.seniorEffective;
  switch (action) {
    case 'final_approve':
      if (!dev.formSubmittedAt) return 'The department has not filled the Deviation Form, so the deviation can only be rejected.';
      if (senior === 'REJECT') return 'Senior authorities rejected this deviation; it can only be rejected.';
      if (senior !== 'APPROVE' && dev.deptOutcome !== 'APPROVED') return 'The department did not approve this deviation. Reject it, or escalate it to senior authorities.';
      return null;
    case 'final_reject':
      return senior === 'APPROVE' ? 'Senior authorities approved this deviation; it can only be approved.' : null;
    case 'escalate':
      if (SENIOR_FINAL.includes(senior)) return 'Senior authorities have already decided this deviation.';
      if (!dev.formSubmittedAt) return 'Escalate only after the department has filled the Deviation Form.';
      return null;
    case 'override':
      return dev.stage === 'FINAL' && !SENIOR_FINAL.includes(senior) ? 'There is no senior decision to override.' : null;
    default:
      return null;
  }
}

export function deviationActions(user, dev, round) {
  return STAGE_ACTIONS[dev.stage].filter((a) => deviationRole(user, dev, a, round) && !deviationBlock(dev, a));
}
