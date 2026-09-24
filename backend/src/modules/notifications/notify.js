import { PERMISSIONS, ROLES } from '@qmas/shared';
import { getEnv } from '../../config/env.js';

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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Mail body in the WRL look: short heading, the message, one button to the record. */
export function mailHtml({ title, body, url }) {
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;padding:24px;color:#1e293b">
<div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#64748b">QMAS · Incoming Inspection</div>
<h1 style="font-size:17px;margin:8px 0 12px">${esc(title)}</h1>
<p style="font-size:14px;line-height:1.5;white-space:pre-line">${esc(body)}</p>
${url ? `<p><a href="${esc(url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Open in QMAS</a></p>` : ''}
<p style="font-size:11px;color:#94a3b8;margin-top:24px">Automatic message from QMAS. Do not reply.</p>
</div></body></html>`;
}

/** In-app notification for each user and a queued mail for those with an e-mail address. */
export async function notifyUsers(db, users, { kind, title, body = null, link = null, exceptUserId = null, attachment = null }) {
  const base = getEnv().APP_BASE_URL.replace(/\/$/, '');
  const seen = new Set();
  for (const u of users) {
    if (!u || seen.has(u.id) || u.id === exceptUserId) continue;
    seen.add(u.id);
    await db.query('INSERT INTO core.notification (user_id, kind, title, body, link) VALUES ($1, $2, $3, $4, $5)', [u.id, kind, title, body, link]);
    if (u.email) {
      const url = link ? `${base}${link}` : null;
      await db.query(
        'INSERT INTO core.mail_outbox (to_address, to_user_id, subject, body_text, body_html, attachment) VALUES ($1, $2, $3, $4, $5, $6)',
        [u.email, u.id, `[QMAS] ${title}`, `${title}\n\n${body ?? ''}${url ? `\n\n${url}` : ''}`, mailHtml({ title, body, url }), attachment ? JSON.stringify(attachment) : null],
      );
    }
  }
  return seen.size;
}

async function context(db, { imirId, deviationId, dnId }) {
  const { rows: m } = await db.query(
    `SELECT m.id, m.imir_no, m.plant_id, m.result, m.inspected_by, i.item_code, i.description, v.name AS vendor_name
       FROM qms.imir m JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id WHERE m.id = $1`,
    [imirId],
  );
  const d = deviationId ? (await db.query('SELECT id, deviation_no, department, stage, initiator_id, qty_due_at FROM qms.deviation WHERE id = $1', [deviationId])).rows[0] : null;
  const n = dnId ? (await db.query('SELECT id, dn_no, created_by, capa_due_at FROM qms.defect_notification WHERE id = $1', [dnId])).rows[0] : null;
  return { imir: m[0], dev: d, dn: n };
}

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Called by `logAction` for every workflow step. Works out who is told what; returns how many
 * users were notified.
 */
export async function notifyForAction(db, entry) {
  const { imirId, deviationId, dnId, action, actorId, payload } = entry;
  const { imir, dev, dn } = await context(db, { imirId, deviationId, dnId });
  if (!imir) return 0;
  const plantId = imir.plant_id;
  const lot = `${imir.item_code} · ${imir.description}\nVendor: ${imir.vendor_name}`;
  const imirLink = `/imirs/${imir.id}`;
  const devLink = dev && `/deviations/${dev.id}`;
  const dnLink = dn && `/dns/${dn.id}`;
  const requestors = () => dev && usersWith(db, { permission: P.DEVIATION_INITIATE, roles: [`${dev.department}_REQUESTOR`], plantId });
  const iqcHead = () => usersWith(db, { permission: P.DEVIATION_FINAL_DECIDE, plantId });
  const stakeholders = () => usersById(db, [imir.inspected_by, dev?.initiator_id, dn?.created_by]);
  const send = async (users, kind, title, body, link) => notifyUsers(db, await users, { kind, title, body, link, exceptUserId: actorId });

  switch (action) {
    case 'SUBMIT':
      return send(usersWith(db, { permission: P.IMIR_REVIEW, plantId }), 'REVIEW', `IMIR ${imir.imir_no} submitted (${imir.result}) — review needed`, lot, imirLink);
    case 'REVERT':
      return send(usersById(db, [imir.inspected_by]), 'REVERTED', `IMIR ${imir.imir_no} sent back to you`, `${entry.remark ?? ''}\n\n${lot}`, imirLink);
    case 'APPROVE':
    case 'HEAD_APPROVE':
      return send(usersById(db, [imir.inspected_by]), 'CLOSED', `IMIR ${imir.imir_no} accepted`, lot, imirLink);
    case 'ESCALATE':
      if (!dev) return send(usersWith(db, { permission: P.IMIR_HEAD_DECIDE, plantId }), 'DECIDE', `IMIR ${imir.imir_no} escalated — IQC Head decision needed`, `${entry.remark ?? ''}\n\n${lot}`, imirLink);
      return send(
        usersWith(db, { permission: P.ESCALATION_DECIDE, roles: payload?.authorities ?? [], plantId }),
        'SENIOR', `Deviation ${dev.deviation_no} escalated to you`, `${entry.remark ?? ''}\n\n${lot}`, devLink,
      );
    case 'HOLD':
      return send(requestors(), 'DEVIATION', `Deviation ${dev.deviation_no}: fill the Deviation Form`, `IMIR ${imir.imir_no} is on hold for ${dev.department}.\n${entry.remark ?? ''}\n\n${lot}`, devLink);
    case 'SUBMIT_FORM':
    case 'DEPT_APPROVE':
      if (dev.stage === 'SUB_HEAD' || dev.stage === 'HEAD') {
        return send(usersWith(db, { permission: P.DEVIATION_APPROVE, roles: [`${dev.department}_${dev.stage}`], plantId }), 'APPROVE', `Deviation ${dev.deviation_no} waiting for your approval`, lot, devLink);
      }
      return send(iqcHead(), 'DECIDE', `Deviation ${dev.deviation_no} approved by ${dev.department} — final decision needed`, lot, devLink);
    case 'DEPT_REJECT':
    case 'RECOMMEND_REJECT':
      return send(iqcHead(), 'DECIDE', `Deviation ${dev.deviation_no} not approved by ${dev.department} — final decision needed`, `${entry.remark ?? ''}\n\n${lot}`, devLink);
    case 'SEND_BACK':
    case 'RETURN_QTY':
      return send(dev.initiator_id ? usersById(db, [dev.initiator_id]) : requestors(), 'REVERTED', `Deviation ${dev.deviation_no} sent back to you`, `${entry.remark ?? ''}\n\n${lot}`, devLink);
    case 'SENIOR_RESULT':
      if (payload?.decision === 'CHANGE_TYPE') return send(requestors(), 'DEVIATION', `Deviation ${dev.deviation_no}: seniors asked for a different type`, lot, devLink);
      return send(iqcHead(), 'DECIDE', `Deviation ${dev.deviation_no}: seniors decided ${payload?.decision === 'APPROVE' ? 'approve' : 'reject'} — close it`, lot, devLink);
    case 'OVERRIDE':
      return dev.stage === 'FINAL' ? send(iqcHead(), 'DECIDE', `Deviation ${dev.deviation_no}: senior decision overridden`, `${entry.remark ?? ''}\n\n${lot}`, devLink) : 0;
    case 'OPS_TIMEOUT':
      return payload?.added?.length
        ? send(usersWith(db, { permission: P.ESCALATION_DECIDE, roles: payload.added, plantId }), 'SENIOR', `Deviation ${dev.deviation_no}: Operations Head did not decide in 24 h — your decision needed`, lot, devLink)
        : 0;
    case 'FINAL_APPROVE':
      if (dev.stage === 'UNDER_DEVIATION') {
        return send(requestors(), 'QTY', `Deviation ${dev.deviation_no} approved — enter OK / Not-OK quantities`, `Due by ${IST.format(new Date(dev.qty_due_at))}.\n\n${lot}`, devLink);
      }
      return send(stakeholders(), 'CLOSED', `Deviation ${dev.deviation_no} approved — lot accepted under deviation`, lot, devLink);
    case 'ENTER_QTY':
      return send(iqcHead(), 'QTY', `Deviation ${dev.deviation_no}: quantities to verify`, `OK ${payload?.okQty} · Not OK ${payload?.notOkQty}\n\n${lot}`, devLink);
    case 'FINAL_REJECT':
      return send(stakeholders(), 'CLOSED', `Deviation ${dev.deviation_no} rejected — lot rejected`, `${entry.remark ?? ''}\n\n${lot}`, devLink);
    case 'VERIFY_QTY':
      return send(stakeholders(), 'CLOSED', `Deviation ${dev.deviation_no} closed — accepted under deviation`, lot, devLink);
    case 'AUTO_CLOSE':
      return send(stakeholders(), 'CLOSED', `Deviation ${dev.deviation_no} auto-closed — quantities not entered in 14 days`, lot, devLink);
    case 'DN_SUBMIT_CAPA':
      return send(usersWith(db, { permission: P.DN_APPROVE_CAPA, plantId }), 'CAPA', `DN ${dn.dn_no}: CAPA to review`, lot, dnLink);
    case 'DN_RESUBMIT':
      return send(usersById(db, [dn.created_by]), 'REVERTED', `DN ${dn.dn_no}: CAPA resubmission requested`, `${entry.remark ?? ''}\n\n${lot}`, dnLink);
    case 'DN_CLOSE':
      return send(stakeholders(), 'CLOSED', `DN ${dn.dn_no} closed`, lot, dnLink);
    case 'CAPA_REMINDER': {
      const users = [...(await usersById(db, [dn.created_by])), ...(await usersWith(db, { permission: P.DN_MANAGE, plantId }))];
      return send(users, 'REMINDER', `DN ${dn.dn_no}: vendor CAPA overdue`, `CAPA was due ${IST.format(new Date(dn.capa_due_at))}.\n\n${lot}`, dnLink);
    }
    default:
      return 0;
  }
}
