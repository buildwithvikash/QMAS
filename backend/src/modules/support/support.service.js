import { PERMISSIONS, SUPPORT_KINDS, SUPPORT_PRIORITIES, SUPPORT_STATUSES } from '@qmas/shared';
import { createHash, randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { getObjectStream, putObject, sniffType } from '../../integrations/storage/index.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, camelRows, likeContains, offsetOf, pageMeta } from '../../shared/sql.js';
import { notifyUsers } from '../notifications/notify.js';

/**
 * Help & Support tickets. Everyone signed in may raise one and follow their own; support.manage
 * holders see every ticket, reply (also with internal notes), assign and move the status.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;
const label = (list, v) => list.find((x) => x.value === v)?.label ?? v;
const isSupport = (user) => user.permissions.has(PERMISSIONS.SUPPORT_MANAGE);
const link = (id) => `/help/tickets/${id}`;
// Statuses a ticket may move to from each status (support team). The reporter may only close a
// resolved ticket or reopen it, which the service checks separately.
const NEXT = {
  OPEN: ['IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'WAITING', 'RESOLVED', 'CLOSED'],
  WAITING: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED', 'OPEN'],
  CLOSED: ['OPEN'],
};
const PRIORITY_RANK = "CASE t.priority WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END";
const SORT = { ticketNo: 't.ticket_no', createdAt: 't.created_at', updatedAt: 't.updated_at', priority: PRIORITY_RANK, status: 't.status' };

const TICKET_SELECT = `
  SELECT t.*, r.full_name AS reported_by_name, r.employee_code AS reported_by_code, r.email AS reported_by_email,
         a.full_name AS assigned_to_name,
         (SELECT count(*)::int FROM core.support_event e WHERE e.ticket_id = t.id AND e.kind = 'COMMENT' AND NOT e.internal) AS reply_count,
         (SELECT count(*)::int FROM core.support_attachment f WHERE f.ticket_id = t.id) AS file_count
    FROM core.support_ticket t
    JOIN core.app_user r ON r.id = t.reported_by
    LEFT JOIN core.app_user a ON a.id = t.assigned_to`;

/** Active users who hold support.manage through an active role (System Admin included). */
export async function supportTeam(db = getPool()) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.email, u.full_name, u.employee_code
       FROM core.user_role ur
       JOIN core.role ro ON ro.code = ur.role_code AND ro.is_active
       JOIN core.role_permission rp ON rp.role_code = ur.role_code AND rp.permission_key = $1
       JOIN core.app_user u ON u.id = ur.user_id
      WHERE u.is_active AND ur.valid_from <= current_date AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)
      ORDER BY u.full_name`,
    [PERMISSIONS.SUPPORT_MANAGE],
  );
  return rows;
}

async function addEvent(db, ticketId, actorId, { kind, body = null, from = null, to = null, internal = false }) {
  await db.query(
    'INSERT INTO core.support_event (ticket_id, kind, body, from_value, to_value, internal, actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [ticketId, kind, body, from, to, internal, actorId],
  );
}

const facts = (t) => [
  ['Ticket', t.ticket_no],
  ['Type', label(SUPPORT_KINDS, t.kind)],
  ['Area', t.module],
  ['Priority', label(SUPPORT_PRIORITIES, t.priority)],
  ['Status', label(SUPPORT_STATUSES, t.status)],
];

async function loadRow(db, id) {
  const { rows } = await db.query(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
  if (!rows[0]) throw AppError.notFound('Ticket');
  return rows[0];
}

/** The ticket if this user may see it (reporter or support team); 404 otherwise. */
async function visibleRow(db, user, id) {
  const row = await loadRow(db, id);
  if (row.reported_by !== user.id && !isSupport(user)) throw AppError.notFound('Ticket');
  return row;
}

export async function create(ctx, user, data) {
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query(
      `INSERT INTO core.support_ticket (kind, module, priority, title, description, steps, expected, reference, page_url, client_info, reported_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [data.kind, data.module, data.priority, data.title, data.description, data.steps ?? null, data.expected ?? null, data.reference ?? null,
        data.pageUrl ?? null, data.clientInfo ? JSON.stringify(data.clientInfo) : null, user.id],
    );
    const id = rows[0].id;
    await addEvent(db, id, user.id, { kind: 'CREATED', to: 'OPEN' });
    const t = await loadRow(db, id);
    await notifyUsers(db, await supportTeam(db), {
      kind: 'SUPPORT_NEW',
      title: `${t.ticket_no}: new ${label(SUPPORT_KINDS, t.kind).toLowerCase()} from ${t.reported_by_name}`,
      body: t.title,
      link: link(id),
      exceptUserId: user.id,
      mail: { tone: t.priority === 'CRITICAL' || t.priority === 'HIGH' ? 'escalation' : 'action', facts: [...facts(t), ['Reported by', `${t.reported_by_name} (${t.reported_by_code})`]] },
    });
    return present(t);
  });
}

export async function list(user, q) {
  const where = [];
  const args = [];
  const add = (sql, v) => {
    args.push(v);
    where.push(sql.replace('$?', `$${args.length}`));
  };
  const scope = isSupport(user) ? q.scope : 'mine';
  if (scope === 'mine') add('t.reported_by = $?', user.id);
  if (scope === 'assigned') add('t.assigned_to = $?', user.id);
  if (q.status === 'ACTIVE') where.push("t.status NOT IN ('RESOLVED', 'CLOSED')");
  else if (q.status) add('t.status = $?', q.status);
  if (q.kind) add('t.kind = $?', q.kind);
  if (q.priority) add('t.priority = $?', q.priority);
  if (q.flag) where.push(`t.status NOT IN ('RESOLVED', 'CLOSED') AND ${q.flag === 'urgent' ? "t.priority IN ('HIGH', 'CRITICAL')" : 't.assigned_to IS NULL'}`);
  if (q.q) {
    args.push(likeContains(q.q));
    const p = `$${args.length}`;
    where.push(`(t.ticket_no ILIKE ${p} OR t.title ILIKE ${p} OR t.reference ILIKE ${p} OR r.full_name ILIKE ${p} OR r.employee_code ILIKE ${p})`);
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getPool();
  const { rows: total } = await db.query(`SELECT count(*)::int AS n FROM core.support_ticket t JOIN core.app_user r ON r.id = t.reported_by ${filter}`, args);
  const { rows } = await db.query(
    `${TICKET_SELECT} ${filter} ORDER BY ${SORT[q.sort]} ${q.order === 'asc' ? 'ASC' : 'DESC'}, t.created_at DESC LIMIT ${q.pageSize} OFFSET ${offsetOf(q)}`,
    args,
  );
  return { rows: rows.map(present), meta: pageMeta(q, total[0].n) };
}

/** Figures for the cards above the list, in the same scope as the list. */
export async function counts(user, scope) {
  const s = isSupport(user) ? scope : 'mine';
  const cond = s === 'mine' ? 'reported_by = $1' : s === 'assigned' ? 'assigned_to = $1' : '$1::uuid IS NOT NULL';
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'OPEN')::int AS open,
            count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
            count(*) FILTER (WHERE status = 'WAITING')::int AS waiting,
            count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
            count(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
            count(*) FILTER (WHERE status NOT IN ('RESOLVED', 'CLOSED') AND priority IN ('HIGH', 'CRITICAL'))::int AS urgent,
            count(*) FILTER (WHERE status NOT IN ('RESOLVED', 'CLOSED') AND assigned_to IS NULL)::int AS unassigned
       FROM core.support_ticket WHERE ${cond}`,
    [user.id],
  );
  return camelRow(rows[0]);
}

function present(row) {
  const t = camelRow(row);
  delete t.reportedByEmail;
  return t;
}

/** What this user may do on the ticket now (the UI shows only these). */
function allowedActions(user, t) {
  const support = isSupport(user);
  const mine = t.reported_by === user.id;
  const out = [];
  if (t.status !== 'CLOSED' || support) out.push('comment');
  if (support) out.push('status', 'priority', 'assign', 'internal');
  if (mine && t.status === 'RESOLVED') out.push('confirm', 'reopen');
  if (mine && !['RESOLVED', 'CLOSED'].includes(t.status)) out.push('withdraw');
  if (t.status !== 'CLOSED' && (mine || support)) out.push('attach');
  return out;
}

export async function detail(user, id, db = getPool()) {
  const row = await visibleRow(db, user, id);
  const support = isSupport(user);
  const { rows: events } = await db.query(
    `SELECT e.id, e.kind, e.body, e.from_value, e.to_value, e.internal, e.at, e.actor_id, u.full_name AS actor_name,
            (e.actor_id = $2) AS by_reporter
       FROM core.support_event e LEFT JOIN core.app_user u ON u.id = e.actor_id
      WHERE e.ticket_id = $1 AND ($3 OR NOT e.internal)
      ORDER BY e.id`,
    [id, row.reported_by, support],
  );
  const { rows: files } = await db.query(
    `SELECT f.id, f.file_name, f.mime_type, f.size_bytes, f.uploaded_at, u.full_name AS uploaded_by_name
       FROM core.support_attachment f LEFT JOIN core.app_user u ON u.id = f.uploaded_by
      WHERE f.ticket_id = $1 ORDER BY f.uploaded_at`,
    [id],
  );
  return { ...present(row), events: camelRows(events), attachments: camelRows(files), allowedActions: allowedActions(user, row) };
}

export async function comment(ctx, user, id, { body, internal }) {
  return withTransaction(ctx, async (db) => {
    const t = await visibleRow(db, user, id);
    const support = isSupport(user);
    const mine = t.reported_by === user.id;
    if (t.status === 'CLOSED' && !support) throw AppError.conflict('This ticket is closed. Raise a new ticket if the problem is back.');
    const isInternal = support && internal;
    await addEvent(db, id, user.id, { kind: 'COMMENT', body, internal: isInternal });
    // The reporter answered a question, or wrote on a resolved ticket: it needs the team again.
    let status = t.status;
    if (mine && !support && (t.status === 'WAITING' || t.status === 'RESOLVED')) {
      status = t.status === 'WAITING' ? 'IN_PROGRESS' : 'OPEN';
      await addEvent(db, id, user.id, { kind: 'STATUS', from: t.status, to: status });
    }
    await db.query(
      `UPDATE core.support_ticket SET updated_at = now(), status = $2,
              resolved_at = CASE WHEN $2 IN ('RESOLVED', 'CLOSED') THEN resolved_at END
        WHERE id = $1`,
      [id, status],
    );
    if (!isInternal) {
      const fresh = await loadRow(db, id);
      if (mine) {
        const team = t.assigned_to ? (await supportTeam(db)).filter((u) => u.id === t.assigned_to) : await supportTeam(db);
        await notifyUsers(db, team, {
          kind: 'SUPPORT_REPLY',
          title: `${t.ticket_no}: ${t.reported_by_name} replied`,
          body: body.slice(0, 300),
          link: link(id),
          exceptUserId: user.id,
          mail: { facts: facts(fresh) },
        });
      } else {
        await notifyUsers(db, [{ id: t.reported_by, email: t.reported_by_email, full_name: t.reported_by_name }], {
          kind: 'SUPPORT_REPLY',
          title: `${t.ticket_no}: reply from the QMAS support team`,
          body: body.slice(0, 300),
          link: link(id),
          exceptUserId: user.id,
          mail: { facts: facts(fresh) },
        });
      }
    }
    return detail(user, id, db);
  });
}

/**
 * Status, priority and assignee (support team). The reporter may also close a resolved ticket
 * ("it works now"), reopen it, or withdraw an open one (status CLOSED).
 */
export async function update(ctx, user, id, { status, priority, assignedTo, note }) {
  return withTransaction(ctx, async (db) => {
    const t = await visibleRow(db, user, id);
    const support = isSupport(user);
    const mine = t.reported_by === user.id;
    if (!support) {
      const reporterMove = mine && !priority && assignedTo === undefined && (
        (t.status === 'RESOLVED' && (status === 'CLOSED' || status === 'OPEN')) ||
        (!['RESOLVED', 'CLOSED'].includes(t.status) && status === 'CLOSED')
      );
      if (!reporterMove) throw AppError.forbidden();
    }
    const sets = ['updated_at = now()'];
    const args = [id];
    const set = (sql, v) => {
      args.push(v);
      sets.push(`${sql} = $${args.length}`);
    };
    const notes = [];

    if (status && status !== t.status) {
      if (support && !NEXT[t.status].includes(status)) throw AppError.conflict(`A ${label(SUPPORT_STATUSES, t.status).toLowerCase()} ticket cannot move to ${label(SUPPORT_STATUSES, status).toLowerCase()}.`);
      set('status', status);
      if (status === 'RESOLVED') sets.push('resolved_at = now()');
      if (status === 'CLOSED') sets.push('closed_at = now()');
      if (status === 'OPEN' || status === 'IN_PROGRESS') sets.push('resolved_at = NULL, closed_at = NULL');
      await addEvent(db, id, user.id, { kind: 'STATUS', from: t.status, to: status, body: note ?? null });
      notes.push(`Status: ${label(SUPPORT_STATUSES, status)}`);
    } else if (note) {
      await addEvent(db, id, user.id, { kind: 'COMMENT', body: note });
    }
    if (priority && priority !== t.priority) {
      set('priority', priority);
      await addEvent(db, id, user.id, { kind: 'PRIORITY', from: t.priority, to: priority });
      notes.push(`Priority: ${label(SUPPORT_PRIORITIES, priority)}`);
    }
    let assignee = null;
    if (assignedTo !== undefined && assignedTo !== t.assigned_to) {
      if (assignedTo) {
        assignee = (await supportTeam(db)).find((u) => u.id === assignedTo);
        if (!assignee) throw AppError.unprocessable('Assign the ticket to someone in the support team.');
      }
      set('assigned_to', assignedTo);
      await addEvent(db, id, user.id, { kind: 'ASSIGNED', from: t.assigned_to_name ?? null, to: assignee?.full_name ?? null });
    }
    await db.query(`UPDATE core.support_ticket SET ${sets.join(', ')} WHERE id = $1`, args);
    const fresh = await loadRow(db, id);

    if (assignee && assignee.id !== user.id) {
      await notifyUsers(db, [assignee], {
        kind: 'SUPPORT_ASSIGNED',
        title: `${t.ticket_no} assigned to you`,
        body: t.title,
        link: link(id),
        mail: { facts: facts(fresh) },
      });
    }
    if (notes.length && !mine) {
      const todo = { WAITING: 'The support team needs more information from you. Open the ticket and reply.', RESOLVED: 'Check that it works now, then close the ticket, or reopen it if not.' }[status];
      await notifyUsers(db, [{ id: t.reported_by, email: t.reported_by_email, full_name: t.reported_by_name }], {
        kind: 'SUPPORT_STATUS',
        title: `${t.ticket_no}: ${notes.join(' · ')}`,
        body: todo ?? note ?? t.title,
        link: link(id),
        exceptUserId: user.id,
        mail: { facts: facts(fresh) },
      });
    } else if (notes.length && mine && !support) {
      const team = t.assigned_to ? (await supportTeam(db)).filter((u) => u.id === t.assigned_to) : [];
      await notifyUsers(db, team, { kind: 'SUPPORT_STATUS', title: `${t.ticket_no}: ${t.reported_by_name} set ${notes.join(' · ').toLowerCase()}`, body: note ?? t.title, link: link(id), exceptUserId: user.id, mail: { facts: facts(fresh) } });
    }
    return detail(user, id, db);
  });
}

export async function addAttachment(ctx, user, id, file) {
  const type = sniffType(file.buffer);
  if (!type) throw AppError.unprocessable('Attach a JPEG, PNG or WebP screenshot, or a PDF.');
  const db = getPool();
  const t = await visibleRow(db, user, id);
  if (!allowedActions(user, t).includes('attach')) throw AppError.conflict('Files cannot be added to a closed ticket.');
  const { rows: n } = await db.query('SELECT count(*)::int AS n FROM core.support_attachment WHERE ticket_id = $1', [id]);
  if (n[0].n >= MAX_FILES) throw AppError.unprocessable(`At most ${MAX_FILES} files per ticket.`);
  const fileId = randomUUID();
  const key = `support/${id}/${fileId}${type.ext}`;
  await putObject(key, file.buffer);
  return withTransaction(ctx, async (tx) => {
    const name = file.originalname.slice(0, 200);
    await tx.query(
      `INSERT INTO core.support_attachment (id, ticket_id, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [fileId, id, name, type.mime, file.size, createHash('sha256').update(file.buffer).digest('hex'), key, user.id],
    );
    await addEvent(tx, id, user.id, { kind: 'FILE', body: name });
    await tx.query('UPDATE core.support_ticket SET updated_at = now() WHERE id = $1', [id]);
    return { id: fileId, fileName: name, mimeType: type.mime, sizeBytes: file.size };
  });
}

export async function openAttachment(user, ticketId, fileId) {
  const db = getPool();
  await visibleRow(db, user, ticketId);
  const { rows } = await db.query('SELECT file_name, mime_type, storage_key FROM core.support_attachment WHERE id = $1 AND ticket_id = $2', [fileId, ticketId]);
  const f = camelRow(rows[0]);
  if (!f) throw AppError.notFound('File');
  return { ...f, stream: getObjectStream(f.storageKey) };
}
