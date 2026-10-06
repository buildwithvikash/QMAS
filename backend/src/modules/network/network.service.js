import { BlockList, isIP } from 'node:net';
import { getEnv } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, camelRows, likeContains, offsetOf, pageMeta } from '../../shared/sql.js';
import { notifyUsers } from '../notifications/notify.js';

/**
 * Network access control. QMAS works only from the company network (the address ranges in
 * core.network_setting, by default the private LAN ranges). From outside, a user needs an
 * external-access grant from an admin, valid for a set period; it lapses by itself at its end.
 * Checked at sign-in, on refresh and on every API request (so a lapsed or revoked grant stops
 * access at once). NETWORK_ACCESS_ENFORCE=false in backend/.env switches the check off as a
 * last resort (e.g. the company ranges were set wrongly and nobody can reach the admin page).
 */

const CACHE_MS = 30_000;
let cache = null; // { at, enforce, networks, list }

export const DENIED_MESSAGE = 'QMAS can be used only from the company network. You are connecting from outside it and have no approved external access. Connect from the office (or VPN), or ask the administrator for external access.';

function toList(networks) {
  const list = new BlockList();
  for (const n of networks) {
    const [addr, bits] = n.split('/');
    const type = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(addr, type);
    else list.addSubnet(addr, Number(bits), type);
  }
  return list;
}

/** The settings, cached for 30 s (the admin page clears the cache when it saves). */
export async function settings(db = getPool()) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const { rows } = await db.query('SELECT enforce, internal_networks, updated_at, updated_by, row_version FROM core.network_setting WHERE id = 1');
  const r = rows[0] ?? { enforce: true, internal_networks: [], row_version: 0 };
  const forcedOff = getEnv().NETWORK_ACCESS_ENFORCE === false;
  cache = { at: Date.now(), enforce: r.enforce && !forcedOff, forcedOff, networks: r.internal_networks, list: toList(r.internal_networks), updatedAt: r.updated_at, rowVersion: r.row_version };
  return cache;
}

const clearCache = () => { cache = null; };

/** Whether an address belongs to the company network (an unknown address does not). */
export function isInternal(ip, list) {
  const kind = isIP(ip ?? '');
  if (!kind) return false;
  return list.check(ip, kind === 6 ? 'ipv6' : 'ipv4');
}

/** The user's grant valid right now, or null. */
export async function activeGrant(userId, db = getPool()) {
  const { rows } = await db.query(
    `SELECT id, starts_at, ends_at, reason FROM core.external_access_grant
      WHERE user_id = $1 AND revoked_at IS NULL AND starts_at <= now() AND ends_at > now()
      ORDER BY ends_at DESC LIMIT 1`,
    [userId],
  );
  return camelRow(rows[0]) ?? null;
}

/**
 * Where a request comes from and whether this user may work from there:
 * { network: 'COMPANY' | 'EXTERNAL', allowed, grant, enforce }.
 */
export async function evaluate(userId, ip) {
  const s = await settings();
  const internal = isInternal(ip, s.list);
  if (internal) return { network: 'COMPANY', allowed: true, grant: null, enforce: s.enforce };
  const grant = userId ? await activeGrant(userId) : null;
  return { network: 'EXTERNAL', allowed: !s.enforce || !!grant, grant, enforce: s.enforce };
}

/** Throws the access-denied error when this user may not work from this address. */
export async function assertAllowed(userId, ip) {
  const r = await evaluate(userId, ip);
  if (!r.allowed) throw AppError.forbidden(DENIED_MESSAGE, { code: 'EXTERNAL_ACCESS_DENIED' });
  return r;
}

/** For the top bar: where the user is connecting from and, outside, until when access lasts. */
export async function status(user, ip) {
  const r = await evaluate(user.id, ip);
  return { ip, network: r.network, enforce: r.enforce, externalAccess: r.grant ? { startsAt: r.grant.startsAt, endsAt: r.grant.endsAt } : null };
}

// ── Admin: company network ────────────────────────────────────────────────────

export async function getSettings(ip) {
  clearCache();
  const s = await settings();
  const { rows } = await getPool().query('SELECT u.full_name FROM core.network_setting n LEFT JOIN core.app_user u ON u.id = n.updated_by WHERE n.id = 1');
  return {
    enforce: s.enforce, forcedOff: s.forcedOff, internalNetworks: s.networks, updatedAt: s.updatedAt, updatedByName: rows[0]?.full_name ?? null, rowVersion: s.rowVersion,
    yourIp: ip, yourNetwork: isInternal(ip, s.list) ? 'COMPANY' : 'EXTERNAL',
  };
}

/** Saves the company ranges. Refuses a list that would shut out the admin saving it. */
export async function saveSettings(ctx, user, ip, { internalNetworks, rowVersion }) {
  const list = toList(internalNetworks);
  if (!isInternal(ip, list) && !(await activeGrant(user.id))) {
    throw AppError.unprocessable(`Your own address (${ip}) is not in these ranges, so you would lose access. Add it, or save from inside the company network.`, [{ path: 'internalNetworks', message: `Include ${ip}.` }]);
  }
  await withTransaction(ctx, async (db) => {
    const { rowCount } = await db.query('UPDATE core.network_setting SET internal_networks = $1, updated_by = $2 WHERE id = 1 AND row_version = $3', [internalNetworks, user.id, rowVersion]);
    if (!rowCount) throw AppError.staleVersion('The network settings');
  });
  clearCache();
  return getSettings(ip);
}

// ── Admin: external access grants (the audit trail) ───────────────────────────

const GRANT_SELECT = `SELECT g.id, g.user_id, u.employee_code, u.full_name AS user_name, g.starts_at, g.ends_at, g.reason,
       g.granted_by, gb.full_name AS granted_by_name, g.granted_at, g.revoked_at, g.revoked_by, rb.full_name AS revoked_by_name, g.revoke_reason,
       CASE WHEN g.revoked_at IS NOT NULL THEN 'REVOKED' WHEN g.ends_at <= now() THEN 'EXPIRED' WHEN g.starts_at > now() THEN 'UPCOMING' ELSE 'ACTIVE' END AS state
  FROM core.external_access_grant g
  JOIN core.app_user u ON u.id = g.user_id
  JOIN core.app_user gb ON gb.id = g.granted_by
  LEFT JOIN core.app_user rb ON rb.id = g.revoked_by`;

const STATE_SQL = {
  ACTIVE: 'g.revoked_at IS NULL AND g.starts_at <= now() AND g.ends_at > now()',
  UPCOMING: 'g.revoked_at IS NULL AND g.starts_at > now()',
  EXPIRED: 'g.revoked_at IS NULL AND g.ends_at <= now()',
  REVOKED: 'g.revoked_at IS NOT NULL',
};

const shape = (r) => r && { ...r, id: Number(r.id) };

export async function listGrants(f) {
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const where = [];
  if (f.state) where.push(STATE_SQL[f.state]);
  if (f.userId) where.push(`g.user_id = ${arg(f.userId)}`);
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(u.full_name ILIKE ${p} OR u.employee_code ILIKE ${p} OR g.reason ILIKE ${p})`);
  }
  const { rows } = await getPool().query(
    `${GRANT_SELECT.replace('SELECT g.id,', 'SELECT count(*) OVER () AS total, g.id,')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY g.granted_at DESC LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { data: camelRows(rows).map(({ total, ...r }) => shape(r)), meta: pageMeta(f, rows[0]?.total ?? 0) };
}

async function getGrant(db, id) {
  const { rows } = await db.query(`${GRANT_SELECT} WHERE g.id = $1`, [id]);
  return shape(camelRow(rows[0]));
}

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export async function grant(ctx, admin, { userId, startsAt, endsAt, reason }) {
  const id = await withTransaction(ctx, async (db) => {
    const { rows: u } = await db.query('SELECT id, email, full_name, is_active FROM core.app_user WHERE id = $1', [userId]);
    if (!u[0]) throw AppError.notFound('User');
    if (!u[0].is_active) throw AppError.unprocessable('This account is deactivated.');
    const { rows } = await db.query(
      'INSERT INTO core.external_access_grant (user_id, starts_at, ends_at, reason, granted_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [userId, startsAt, endsAt, reason, admin.id],
    );
    await notifyUsers(db, [u[0]], {
      kind: 'ACCESS', title: 'External access approved', body: `You may use QMAS from outside the company network from ${IST.format(new Date(startsAt))} to ${IST.format(new Date(endsAt))}.\nReason: ${reason}`,
      exceptUserId: admin.id,
      mail: { tone: 'good', pill: 'External access', todo: `Access from outside the company network is allowed from ${IST.format(new Date(startsAt))} until ${IST.format(new Date(endsAt))}. It ends by itself then.`, reason: 'You get this because an administrator approved external access for you.' },
    });
    return rows[0].id;
  });
  return getGrant(getPool(), id);
}

export async function revoke(ctx, admin, id, { reason }) {
  await withTransaction(ctx, async (db) => {
    const g = await getGrant(db, id);
    if (!g) throw AppError.notFound('External access');
    if (g.state === 'REVOKED' || g.state === 'EXPIRED') throw AppError.conflict(`This external access has already ${g.state === 'REVOKED' ? 'been revoked' : 'ended'}.`);
    await db.query('UPDATE core.external_access_grant SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1', [id, admin.id, reason]);
    const { rows: u } = await db.query('SELECT id, email, full_name FROM core.app_user WHERE id = $1', [g.userId]);
    await notifyUsers(db, u, {
      kind: 'ACCESS', title: 'External access ended', body: `Your access from outside the company network was revoked.\nReason: ${reason}`, exceptUserId: admin.id,
      mail: { tone: 'bad', todo: 'Your access from outside the company network was revoked by an administrator. QMAS works again from the company network.', reason: 'You get this because you had external access.' },
    });
  });
  return getGrant(getPool(), id);
}
