import { ROLES } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { pageMeta } from '../../shared/sql.js';
import { invalidateAccess } from '../auth/access.service.js';
import { recordAuthEvent } from '../auth/auth.service.js';
import { hashPassword, passwordProblems } from '../auth/password.js';
import * as repo from './users.repo.js';

export async function list(filters) {
  const { rows, total } = await repo.list(getPool(), filters);
  return { data: rows, meta: pageMeta(filters, total) };
}

export async function get(id, db = getPool()) {
  const user = await repo.findById(db, id);
  if (!user) throw AppError.notFound('User');
  return { ...user, roles: await repo.rolesOf(db, id) };
}

/** Checks role codes, plant requirements and duplicates before any write. */
async function checkAssignments(db, roles) {
  if (roles.length === 0) return;
  const { rows: roleRows } = await db.query('SELECT code, name, requires_plant FROM core.role WHERE code = ANY($1)', [roles.map((r) => r.roleCode)]);
  const byCode = new Map(roleRows.map((r) => [r.code, r]));
  const plantIds = [...new Set(roles.map((r) => r.plantId).filter(Boolean))];
  const { rows: plantRows } = await db.query('SELECT id FROM core.plant WHERE id = ANY($1) AND is_active', [plantIds]);
  const activePlants = new Set(plantRows.map((p) => p.id));

  const errors = [];
  const seen = new Set();
  roles.forEach((r, i) => {
    const role = byCode.get(r.roleCode);
    if (!role) return errors.push({ path: `roles.${i}.roleCode`, message: `Unknown role ${r.roleCode}.` });
    if (role.requires_plant && !r.plantId) errors.push({ path: `roles.${i}.plantId`, message: `${role.name} must be assigned to a plant.` });
    if (r.plantId && !activePlants.has(r.plantId)) errors.push({ path: `roles.${i}.plantId`, message: 'Choose an active plant.' });
    const key = `${r.roleCode}:${r.plantId ?? 0}`;
    if (seen.has(key)) errors.push({ path: `roles.${i}.roleCode`, message: `${role.name} is assigned twice for the same plant.` });
    seen.add(key);
  });
  if (errors.length) throw AppError.unprocessable('Some role assignments need attention.', errors);
}

export async function create(ctx, input) {
  const problem = passwordProblems(input.temporaryPassword, { employeeCode: input.employeeCode });
  if (problem) throw AppError.unprocessable(problem, [{ path: 'temporaryPassword', message: problem }]);
  const passwordHash = await hashPassword(input.temporaryPassword);

  return withTransaction(ctx, async (db) => {
    await checkAssignments(db, input.roles);
    const id = await repo.insert(db, { ...input, passwordHash, actorId: ctx.userId });
    await repo.replaceRoles(db, id, input.roles, ctx.userId);
    return get(id, db);
  });
}

export async function update(ctx, id, { rowVersion, ...fields }) {
  if (id === ctx.userId && fields.isActive === false) throw AppError.unprocessable('You cannot deactivate your own account.');
  const result = await withTransaction(ctx, async (db) => {
    const current = await repo.findById(db, id, { forUpdate: true });
    if (!current) throw AppError.notFound('User');
    if (fields.isActive === false && current.isActive) {
      await ensureAnotherAdmin(db, id);
      await repo.revokeSessions(db, id, 'DEACTIVATED');
    }
    if (!(await repo.update(db, id, rowVersion, fields))) throw AppError.staleVersion('This user');
    return get(id, db);
  });
  invalidateAccess(id);
  return result;
}

export async function setRoles(ctx, id, { roles, rowVersion }) {
  const result = await withTransaction(ctx, async (db) => {
    const current = await repo.findById(db, id, { forUpdate: true });
    if (!current) throw AppError.notFound('User');
    await checkAssignments(db, roles);
    if (!roles.some((r) => r.roleCode === ROLES.SYSTEM_ADMIN)) await ensureAnotherAdmin(db, id);
    if (!(await repo.bumpVersion(db, id, rowVersion))) throw AppError.staleVersion('This user');
    await repo.replaceRoles(db, id, roles, ctx.userId);
    return get(id, db);
  });
  invalidateAccess(id);
  return result;
}

export async function resetPassword(ctx, id, { temporaryPassword }, meta) {
  const user = await get(id);
  const problem = passwordProblems(temporaryPassword, { employeeCode: user.employeeCode });
  if (problem) throw AppError.unprocessable(problem, [{ path: 'temporaryPassword', message: problem }]);
  const passwordHash = await hashPassword(temporaryPassword);
  await withTransaction(ctx, async (db) => {
    await repo.setPassword(db, id, passwordHash);
    await repo.revokeSessions(db, id, 'PASSWORD_RESET');
    await recordAuthEvent(db, 'PASSWORD_RESET', { ...meta, userId: id, employeeCode: user.employeeCode, detail: { by: ctx.userId } });
  });
  invalidateAccess(id);
  return get(id);
}

export async function unlock(ctx, id, meta) {
  const user = await get(id);
  await withTransaction(ctx, async (db) => {
    await repo.unlock(db, id);
    await recordAuthEvent(db, 'UNLOCKED', { ...meta, userId: id, employeeCode: user.employeeCode, detail: { by: ctx.userId } });
  });
  return get(id);
}

/** Refuses a change that would leave no active System Admin. */
async function ensureAnotherAdmin(db, userId) {
  const { rows } = await db.query(
    "SELECT 1 FROM core.user_role WHERE user_id = $1 AND role_code = 'SYSTEM_ADMIN'",
    [userId],
  );
  if (rows.length && (await repo.countActiveAdmins(db, userId)) === 0) {
    throw AppError.unprocessable('At least one active System Admin must remain. Assign the role to someone else first.');
  }
}
