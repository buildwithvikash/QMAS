import nodemailer from 'nodemailer';
import { getEnv } from '../../config/env.js';
import { getPool } from '../../db/pool.js';

const MAX_ATTEMPTS = 8;
const LEASE_MINUTES = 5;

/** Renderers for attachments stored by reference in the outbox (rendered fresh at send time). */
const renderers = new Map();
export const registerAttachmentRenderer = (type, fn) => renderers.set(type, fn);

let defaultTransport;
function transportFromEnv() {
  const env = getEnv();
  if (env.MAIL_TRANSPORT === 'smtp') {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return nodemailer.createTransport({ jsonTransport: true }); // 'log': nothing leaves the machine
}

/**
 * Sends queued mail. Rows are leased (next_attempt_at pushed ahead) under SKIP LOCKED, so several
 * workers never send the same mail twice; a failed send is retried with growing delays and marked
 * FAILED after 8 attempts. Returns { sent, failed }.
 */
export async function sendPendingMail({ transport = (defaultTransport ??= transportFromEnv()), log, now = new Date(), limit = 20 } = {}) {
  const env = getEnv();
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE core.mail_outbox SET next_attempt_at = $1::timestamptz + make_interval(mins => ${LEASE_MINUTES})
      WHERE id IN (SELECT id FROM core.mail_outbox WHERE status = 'PENDING' AND next_attempt_at <= $1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING id, to_address, subject, body_text, body_html, attachment, attempts`,
    [now, limit],
  );
  let sent = 0;
  let failed = 0;
  for (const m of rows) {
    try {
      const attachments = [];
      if (m.attachment) {
        const render = renderers.get(m.attachment.type);
        if (!render) throw new Error(`No renderer for attachment ${m.attachment.type}`);
        attachments.push(await render(m.attachment));
      }
      await transport.sendMail({ from: env.MAIL_FROM, to: m.to_address, subject: m.subject, text: m.body_text, html: m.body_html, attachments });
      await pool.query("UPDATE core.mail_outbox SET status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1", [m.id]);
      if (env.MAIL_TRANSPORT === 'log') log?.info({ mailId: m.id, to: m.to_address, subject: m.subject }, 'mail (log transport, not sent)');
      sent += 1;
    } catch (err) {
      const attempts = m.attempts + 1;
      const delayMin = Math.min(2 ** attempts, 240);
      await pool.query(
        `UPDATE core.mail_outbox SET attempts = $2::smallint, last_error = $3, status = CASE WHEN $2::smallint >= ${MAX_ATTEMPTS} THEN 'FAILED' ELSE 'PENDING' END,
                next_attempt_at = $4::timestamptz + make_interval(mins => $5::int) WHERE id = $1`,
        [m.id, attempts, String(err.message).slice(0, 500), now, delayMin],
      );
      log?.warn({ mailId: m.id, attempts, err: err.message }, 'mail send failed');
      failed += 1;
    }
  }
  return { sent, failed };
}
