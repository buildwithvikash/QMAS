import { PERMISSIONS, ROLES } from '@qmas/shared';
import { getEnv } from '../../config/env.js';
import { renderMail } from './mailTemplate.js';

/**
 * Hand-off notifications (M12): every workflow step tells the people who act next, and closures
 * tell the people involved. Written in the same transaction as the step (in-app bell + mail
 * outbox), so a notification exists exactly when the step committed. Mail is sent later by the worker.
 */

const P = PERMISSIONS;

/**
 * Active users holding `permission` through a role that covers the plant (optionally only `roles`).
 * System Admin is left out: the admin can stand in for anyone but is not everyone's inbox.
 */
export async function usersWith(db, { permission, roles = null, plantId }) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.email, u.full_name
       FROM core.user_role ur
       JOIN core.role r ON r.code = ur.role_code
       JOIN core.role_permission rp ON rp.role_code = ur.role_code AND rp.permission_key = $1
       JOIN core.app_user u ON u.id = ur.user_id
      WHERE u.is_active AND ur.role_code <> $4
        AND ($2::text[] IS NULL OR ur.role_code = ANY($2))
        AND (r.action_scope = 'ALL' OR ur.plant_id IS NULL OR ur.plant_id = $3)
        AND ur.valid_from <= current_date AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)`,
    [permission, roles, plantId, ROLES.SYSTEM_ADMIN],
  );
  return rows;
}

async function usersById(db, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return [];
  const { rows } = await db.query('SELECT id, email, full_name FROM core.app_user WHERE id = ANY($1) AND is_active', [list]);
  return rows;
}

/**
 * In-app notification for each user and a queued mail for those with an e-mail address. `mail`
 * holds the extra parts of the mail (tone, what to do, facts, recent activity; see renderMail).
 */
export async function notifyUsers(db, users, { kind, title, body = null, link = null, exceptUserId = null, attachment = null, mail = {} }) {
  const base = getEnv().APP_BASE_URL.replace(/\/$/, '');
  const seen = new Set();
  for (const u of users) {
    if (!u || seen.has(u.id) || u.id === exceptUserId) continue;
    seen.add(u.id);
    await db.query('INSERT INTO core.notification (user_id, kind, title, body, link) VALUES ($1, $2, $3, $4, $5)', [u.id, kind, title, body, link]);
    if (u.email) {
      const url = link ? `${base}${link}` : null;
      const { html, text } = renderMail({ title, todo: body, ...mail, url, greeting: u.full_name });
      await db.query(
        'INSERT INTO core.mail_outbox (to_address, to_user_id, subject, body_text, body_html, attachment) VALUES ($1, $2, $3, $4, $5, $6)',
        [u.email, u.id, `[QMAS] ${title}`, text, html, attachment ? JSON.stringify(attachment) : null],
      );
    }
  }
  return seen.size;
}

async function context(db, { imirId, deviationId, dnId, actorId, actingRole }) {
  const { rows: m } = await db.query(
    `SELECT m.id, m.imir_no, m.plant_id, m.result, m.status, m.inspected_by, m.grn_no, m.grn_date, m.invoice_no, m.inward_qty, m.uom,
            m.defective_samples, m.sample_size, p.sap_code AS plant_code, p.name AS plant_name,
            i.item_code, i.description, v.vendor_code, v.name AS vendor_name
       FROM qms.imir m JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
       JOIN core.plant p ON p.id = m.plant_id LEFT JOIN intg.sap_inspection_lot l ON l.id = m.sap_lot_id
      WHERE m.id = $1`,
    [imirId],
  );
  const d = deviationId
    ? (await db.query('SELECT id, deviation_no, department, stage, initiator_id, qty_due_at, action, severity, deviation_qty FROM qms.deviation WHERE id = $1', [deviationId])).rows[0]
    : null;
  const n = dnId ? (await db.query('SELECT id, dn_no, created_by, capa_due_at, defective_qty, capa_applicable FROM qms.defect_notification WHERE id = $1', [dnId])).rows[0] : null;
  const actor = actorId
    ? (await db.query('SELECT u.full_name, r.name AS role_name FROM core.app_user u LEFT JOIN core.role r ON r.code = $2 WHERE u.id = $1', [actorId, actingRole ?? null])).rows[0]
    : null;
  const { rows: steps } = await db.query(
    `SELECT a.action, a.at, u.full_name AS actor_name, r.name AS role_name
       FROM qms.imir_action a LEFT JOIN core.app_user u ON u.id = a.actor_id LEFT JOIN core.role r ON r.code = a.acting_role
      WHERE a.imir_id = $1 ORDER BY a.at DESC, a.id DESC LIMIT 5`,
    [imirId],
  );
  return { imir: m[0], dev: d, dn: n, actor, steps };
}

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const when = (t) => (t ? IST.format(new Date(t)) : null);
const num = (v) => (v === null || v === undefined ? null : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

// Where the lot stands, in the words of the app's route rail.
const STAGE = {
  OPEN: 'Inspection (not started)', IN_INSPECTION: 'Inspection', SUBMITTED: 'Incharge review', WITH_IQC_HEAD: 'IQC Head decision',
  DEPT_REVIEW: 'SCM / VD approval', IQC_HEAD_FINAL: 'IQC Head final decision', SENIOR_ESCALATION: 'Senior escalation',
  UNDER_DEVIATION: 'Awaiting OK / Not-OK quantities', QTY_VERIFICATION: 'Quantity verification', CLOSED_ACCEPTED: 'Closed: accepted',
  CLOSED_REJECTED: 'Closed: rejected', CLOSED_UNDER_DEVIATION: 'Closed: accepted under deviation', AUTO_CLOSED: 'Closed: auto-closed',
};
// Workflow steps in the "Recent activity" table: label and colour.
const STEP = {
  SUBMIT: ['Inspection submitted', 'info'], APPROVE: ['Approved by Incharge', 'good'], REVERT: ['Sent back to inspector', 'warn'],
  ESCALATE: ['Escalated', 'esc'], HEAD_APPROVE: ['Approved by IQC Head', 'good'], HOLD: ['Put on hold', 'esc'],
  SUBMIT_FORM: ['Deviation Form submitted', 'info'], RECOMMEND_REJECT: ['Rejection recommended', 'bad'], DEPT_APPROVE: ['Approved by department', 'good'],
  SEND_BACK: ['Sent back to initiator', 'warn'], DEPT_REJECT: ['Rejected by department', 'bad'], FINAL_APPROVE: ['Deviation approved', 'good'],
  FINAL_REJECT: ['Deviation rejected', 'bad'], SENIOR_DECISION: ['Senior decision', 'esc'], SENIOR_RESULT: ['Senior escalation decided', 'esc'],
  OVERRIDE: ['Decision overridden', 'esc'], OPS_TIMEOUT: ['Ops Head did not decide in 24 h', 'bad'], ENTER_QTY: ['Quantities entered', 'info'],
  VERIFY_QTY: ['Quantities verified', 'good'], RETURN_QTY: ['Quantities returned', 'warn'], AUTO_CLOSE: ['Auto-closed', 'bad'],
  DN_RAISE: ['DN raised', 'info'], DN_SUBMIT_CAPA: ['CAPA submitted', 'info'], DN_RESUBMIT: ['CAPA resubmission asked', 'warn'],
  DN_CLOSE: ['DN closed', 'good'], CAPA_REMINDER: ['CAPA overdue reminder', 'warn'],
};
const WORD = { UAI: 'Use As Is', SEGREGATION: 'Segregation', REWORK: 'Rework' };
const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

/** The details block of a mail: the lot, and the deviation or DN when the step is about one. */
function factsOf({ imir, dev, dn }) {
  const nok = imir.defective_samples?.length ? ` (NOK in sample ${imir.defective_samples.join(', ')} of ${imir.sample_size})` : '';
  const facts = [
    ['IMIR no.', imir.imir_no, true],
    ['Item', `${imir.item_code} — ${imir.description}`, true],
    ['Vendor', `${imir.vendor_name} (${imir.vendor_code})`],
    ['Plant', imir.plant_name],
    ['GRN', `${imir.grn_no} · ${DAY.format(new Date(imir.grn_date))}${imir.invoice_no ? ` · Invoice ${imir.invoice_no}` : ''}`],
    ['Inward qty', `${num(imir.inward_qty)}${imir.uom ? ` ${imir.uom}` : ''}`],
    ['Inspection result', imir.result ? `${imir.result === 'NOK' ? 'Not OK' : 'OK'}${nok}` : null, imir.result === 'NOK'],
    ['Current stage', STAGE[imir.status] ?? imir.status, true],
  ];
  if (dev) {
    facts.push(
      ['Deviation no.', dev.deviation_no, true],
      ['Department', dev.department],
      ['Action · severity', dev.action ? `${WORD[dev.action] ?? dev.action}${dev.severity ? ` · ${cap(dev.severity)}` : ''}` : null],
      ['Deviation qty', num(dev.deviation_qty)],
    );
  }
  if (dn) {
    facts.push(['DN no.', dn.dn_no, true], ['Defective qty', num(dn.defective_qty)], ['CAPA due', dn.capa_applicable ? when(dn.capa_due_at) : 'Not applicable']);
  }
  return facts;
}

/**
 * Called by `logAction` for every workflow step. Works out who is told what, with what to do
 * next; returns how many users were notified.
 */
export async function notifyForAction(db, entry) {
  const { imirId, deviationId, dnId, action, actorId, actingRole, payload, remark } = entry;
  const ctx = await context(db, { imirId, deviationId, dnId, actorId, actingRole });
  const { imir, dev, dn, actor } = ctx;
  if (!imir) return 0;
  const plantId = imir.plant_id;
  const lot = `${imir.item_code} · ${imir.description}\nVendor: ${imir.vendor_name}`;
  const imirLink = `/imirs/${imir.id}`;
  const devLink = dev && `/deviations/${dev.id}`;
  const dnLink = dn && `/dns/${dn.id}`;
  const requestors = () => dev && usersWith(db, { permission: P.DEVIATION_INITIATE, roles: [`${dev.department}_REQUESTOR`], plantId });
  const iqcHead = () => usersWith(db, { permission: P.DEVIATION_FINAL_DECIDE, plantId });
  const stakeholders = () => usersById(db, [imir.inspected_by, dev?.initiator_id, dn?.created_by]);
  const by = actor ? `${actor.full_name}${actor.role_name ? `, ${actor.role_name}` : ''}` : 'QMAS';
  const common = {
    plant: `Plant ${imir.plant_name}`,
    record: dn?.dn_no ?? dev?.deviation_no ?? imir.imir_no,
    remark: remark ? { text: remark, by } : null,
    facts: factsOf(ctx),
    steps: ctx.steps.map((s) => ({ label: STEP[s.action]?.[0] ?? s.action, tone: STEP[s.action]?.[1], by: s.actor_name ?? 'System', role: s.role_name, at: IST.format(new Date(s.at)) })),
  };

  /** users, kind, title, in-app body, link, and for the mail: tone, what to do, due, button, why. */
  const send = async (users, kind, title, body, link, mail) =>
    notifyUsers(db, await users, { kind, title, body, link, exceptUserId: actorId, mail: { ...common, ...mail } });
  const openImir = 'Open the IMIR';
  const openDev = 'Open the deviation';
  const openDn = 'Open the DN';

  switch (action) {
    case 'SUBMIT':
      return send(usersWith(db, { permission: P.IMIR_REVIEW, plantId }), 'REVIEW', `IMIR ${imir.imir_no} submitted (${imir.result}) — review needed`, lot, imirLink, {
        tone: 'action', todo: `Review the inspection by ${by} and approve it, send it back, or escalate it to the IQC Head.`, button: 'Review the IMIR',
        reason: 'You get this as IQC Incharge of this plant.',
      });
    case 'REVERT':
      return send(usersById(db, [imir.inspected_by]), 'REVERTED', `IMIR ${imir.imir_no} sent back to you`, `${remark ?? ''}\n\n${lot}`, imirLink, {
        tone: 'sendback', todo: 'Correct the inspection as asked in the remark below and submit it again.', button: openImir,
        reason: 'You get this because you inspected this lot.',
      });
    case 'APPROVE':
    case 'HEAD_APPROVE':
      return send(usersById(db, [imir.inspected_by]), 'CLOSED', `IMIR ${imir.imir_no} accepted`, lot, imirLink, {
        tone: 'good', pill: 'Accepted', todo: `The lot was accepted by ${by}. No action needed.`, button: openImir,
        reason: 'You get this because you inspected this lot.',
      });
    case 'ESCALATE':
      if (!dev) {
        return send(usersWith(db, { permission: P.IMIR_HEAD_DECIDE, plantId }), 'DECIDE', `IMIR ${imir.imir_no} escalated — IQC Head decision needed`, `${remark ?? ''}\n\n${lot}`, imirLink, {
          tone: 'escalation', todo: 'Decide the lot: approve it, or put it on hold and send it to SCM / VD for a deviation.', button: 'Decide the lot',
          reason: 'You get this as Plant IQC Head.',
        });
      }
      return send(usersWith(db, { permission: P.ESCALATION_DECIDE, roles: payload?.authorities ?? [], plantId }), 'SENIOR', `Deviation ${dev.deviation_no} escalated to you`, `${remark ?? ''}\n\n${lot}`, devLink, {
        tone: 'escalation', pill: `Escalated · round ${payload?.round ?? 1}`, todo: 'Record your decision on this deviation: approve, reject, or ask for a different type.',
        button: 'Record your decision', reason: 'You get this as one of the senior authorities this deviation was escalated to.',
      });
    case 'HOLD':
      return send(requestors(), 'DEVIATION', `Deviation ${dev.deviation_no}: fill the Deviation Form`, `IMIR ${imir.imir_no} is on hold for ${dev.department}.\n${remark ?? ''}\n\n${lot}`, devLink, {
        tone: 'action', pill: 'On hold', todo: `The lot is on hold for ${dev.department}. Fill in and submit the Deviation Form.`, button: 'Fill the Deviation Form',
        reason: `You get this as ${dev.department} Requestor of this plant.`,
      });
    case 'SUBMIT_FORM':
    case 'DEPT_APPROVE':
      if (dev.stage === 'SUB_HEAD' || dev.stage === 'HEAD') {
        return send(usersWith(db, { permission: P.DEVIATION_APPROVE, roles: [`${dev.department}_${dev.stage}`], plantId }), 'APPROVE', `Deviation ${dev.deviation_no} waiting for your approval`, lot, devLink, {
          tone: 'action', todo: 'Check the Deviation Form and approve it, send it back to the initiator, or reject it.', button: 'Review the form',
          reason: `You get this as ${dev.department} ${dev.stage === 'HEAD' ? 'Head' : 'Sub-Head'}.`,
        });
      }
      return send(iqcHead(), 'DECIDE', `Deviation ${dev.deviation_no} approved by ${dev.department} — final decision needed`, lot, devLink, {
        tone: 'action', todo: `${dev.department} approved the deviation. Take the final decision: approve, reject, or escalate to the senior authorities.`,
        button: 'Take the final decision', reason: 'You get this as Plant IQC Head.',
      });
    case 'DEPT_REJECT':
    case 'RECOMMEND_REJECT':
      return send(iqcHead(), 'DECIDE', `Deviation ${dev.deviation_no} not approved by ${dev.department} — final decision needed`, `${remark ?? ''}\n\n${lot}`, devLink, {
        tone: 'action', pill: 'Not approved', todo: `${dev.department} did not approve the deviation. Take the final decision.`, button: 'Take the final decision',
        reason: 'You get this as Plant IQC Head.',
      });
    case 'SEND_BACK':
    case 'RETURN_QTY':
      return send(dev.initiator_id ? usersById(db, [dev.initiator_id]) : requestors(), 'REVERTED', `Deviation ${dev.deviation_no} sent back to you`, `${remark ?? ''}\n\n${lot}`, devLink, {
        tone: 'sendback', todo: action === 'RETURN_QTY' ? 'Correct the OK / Not-OK quantities as asked below and enter them again.' : 'Correct the Deviation Form as asked below and submit it again.',
        button: openDev, reason: 'You get this as the initiator of this deviation.',
      });
    case 'SENIOR_RESULT':
      if (payload?.decision === 'CHANGE_TYPE') {
        return send(requestors(), 'DEVIATION', `Deviation ${dev.deviation_no}: seniors asked for a different type`, lot, devLink, {
          tone: 'sendback', pill: 'Change type', todo: 'The senior authorities asked for a different deviation type. Revise the Deviation Form and submit it again.',
          button: 'Revise the form', reason: `You get this as ${dev.department} Requestor of this plant.`,
        });
      }
      return send(iqcHead(), 'DECIDE', `Deviation ${dev.deviation_no}: seniors decided ${payload?.decision === 'APPROVE' ? 'approve' : 'reject'} — close it`, lot, devLink, {
        tone: 'action', pill: 'Seniors decided', todo: `The senior escalation ended in ${payload?.decision === 'APPROVE' ? 'approval' : 'rejection'}. Record the final decision to close it.`,
        button: 'Record the final decision', reason: 'You get this as Plant IQC Head.',
      });
    case 'OVERRIDE':
      return dev.stage === 'FINAL'
        ? send(iqcHead(), 'DECIDE', `Deviation ${dev.deviation_no}: senior decision overridden`, `${remark ?? ''}\n\n${lot}`, devLink, {
          tone: 'escalation', pill: 'Overridden', todo: `${by} overrode the senior decision. Record the final decision.`, button: 'Record the final decision',
          reason: 'You get this as Plant IQC Head.',
        })
        : 0;
    case 'OPS_TIMEOUT':
      return payload?.added?.length
        ? send(usersWith(db, { permission: P.ESCALATION_DECIDE, roles: payload.added, plantId }), 'SENIOR', `Deviation ${dev.deviation_no}: Operations Head did not decide in 24 h — your decision needed`, lot, devLink, {
          tone: 'escalation', pill: 'Added to escalation', todo: 'The Central Operations Head did not decide within 24 hours, so the decision passes to you.',
          button: 'Record your decision', reason: 'You get this as CQA Head.',
        })
        : 0;
    case 'FINAL_APPROVE':
      if (dev.stage === 'UNDER_DEVIATION') {
        return send(requestors(), 'QTY', `Deviation ${dev.deviation_no} approved — enter OK / Not-OK quantities`, `Due by ${IST.format(new Date(dev.qty_due_at))}.\n\n${lot}`, devLink, {
          tone: 'action', pill: 'Approved', todo: 'The deviation was approved. Enter the OK and Not-OK quantities after segregation or rework.', due: when(dev.qty_due_at),
          button: 'Enter quantities', reason: `You get this as ${dev.department} Requestor of this plant. Without quantities the deviation closes automatically after 14 days.`,
        });
      }
      return send(stakeholders(), 'CLOSED', `Deviation ${dev.deviation_no} approved — lot accepted under deviation`, lot, devLink, {
        tone: 'good', pill: 'Accepted under deviation', todo: 'The lot was accepted under deviation. No action needed.', button: openDev,
        reason: 'You get this because you worked on this lot.',
      });
    case 'ENTER_QTY':
      return send(iqcHead(), 'QTY', `Deviation ${dev.deviation_no}: quantities to verify`, `OK ${payload?.okQty} · Not OK ${payload?.notOkQty}\n\n${lot}`, devLink, {
        tone: 'action', todo: `Verify the quantities entered by ${by}: OK ${num(payload?.okQty)} · Not OK ${num(payload?.notOkQty)}. Accept them or return them for correction.`,
        button: 'Verify quantities', reason: 'You get this as Plant IQC Head.',
      });
    case 'FINAL_REJECT':
      return send(stakeholders(), 'CLOSED', `Deviation ${dev.deviation_no} rejected — lot rejected`, `${remark ?? ''}\n\n${lot}`, devLink, {
        tone: 'bad', todo: `The deviation was rejected by ${by}; the lot is rejected.`, button: openDev, reason: 'You get this because you worked on this lot.',
      });
    case 'VERIFY_QTY':
      return send(stakeholders(), 'CLOSED', `Deviation ${dev.deviation_no} closed — accepted under deviation`, lot, devLink, {
        tone: 'good', todo: `Quantities verified by ${by}: OK ${num(payload?.okQty)} · Not OK ${num(payload?.notOkQty)}. The deviation is closed.`, button: openDev,
        reason: 'You get this because you worked on this lot.',
      });
    case 'AUTO_CLOSE':
      return send(stakeholders(), 'CLOSED', `Deviation ${dev.deviation_no} auto-closed — quantities not entered in 14 days`, lot, devLink, {
        tone: 'bad', pill: 'Auto-closed', todo: 'OK / Not-OK quantities were not entered within 14 days, so QMAS closed the deviation.', button: openDev,
        reason: 'You get this because you worked on this lot.',
      });
    case 'DN_SUBMIT_CAPA':
      return send(usersWith(db, { permission: P.DN_APPROVE_CAPA, plantId }), 'CAPA', `DN ${dn.dn_no}: CAPA to review`, lot, dnLink, {
        tone: 'action', todo: dn.capa_applicable ? `Review the vendor's CAPA entered by ${by}: approve it and close the DN, or ask for a resubmission.` : 'CAPA is not applicable. Review and close the DN.',
        button: 'Review the CAPA', reason: 'You get this as Plant IQC Head.',
      });
    case 'DN_RESUBMIT':
      return send(usersById(db, [dn.created_by]), 'REVERTED', `DN ${dn.dn_no}: CAPA resubmission requested`, `${remark ?? ''}\n\n${lot}`, dnLink, {
        tone: 'sendback', todo: "Get a revised CAPA from the vendor as asked below and submit it again.", due: when(dn.capa_due_at), button: openDn,
        reason: 'You get this because you raised this DN.',
      });
    case 'DN_CLOSE':
      return send(stakeholders(), 'CLOSED', `DN ${dn.dn_no} closed`, lot, dnLink, {
        tone: 'good', todo: `The CAPA was accepted by ${by} and the DN is closed.`, button: openDn, reason: 'You get this because you worked on this lot.',
      });
    case 'CAPA_REMINDER': {
      const users = [...(await usersById(db, [dn.created_by])), ...(await usersWith(db, { permission: P.DN_MANAGE, plantId }))];
      return send(users, 'REMINDER', `DN ${dn.dn_no}: vendor CAPA overdue`, `CAPA was due ${IST.format(new Date(dn.capa_due_at))}.\n\n${lot}`, dnLink, {
        tone: 'reminder', pill: 'CAPA overdue', todo: `The vendor's CAPA is overdue. Follow up with ${imir.vendor_name} and enter the CAPA in QMAS.`, due: when(dn.capa_due_at),
        button: openDn, reason: 'You get this as IQC Incharge of this plant. Reminders repeat every 2 days while the CAPA is overdue.',
      });
    }
    default:
      return 0;
  }
}
