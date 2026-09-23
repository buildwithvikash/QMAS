import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool } from '../src/db/pool.js';
import { hashPassword } from '../src/modules/auth/password.js';

let app;
export const getApp = () => (app ??= createApp());

export const uid = (prefix = 'T') => `${prefix}${randomBytes(4).toString('hex').toUpperCase()}`;

const plantIds = new Map();
/** Id of a seeded plant by SAP code. */
export async function plantId(sapCode = '1115') {
  if (!plantIds.has(sapCode)) {
    const { rows } = await getPool().query('SELECT id FROM core.plant WHERE sap_code = $1', [sapCode]);
    plantIds.set(sapCode, rows[0].id);
  }
  return plantIds.get(sapCode);
}

/**
 * Inserts a user directly. roles: [{ roleCode, plantId? }].
 * Returns { id, employeeCode, password }.
 */
export async function createUser({ roles = [], mustChangePassword = false, isActive = true } = {}) {
  const employeeCode = uid('E');
  const password = `Pw${randomBytes(6).toString('hex')}9`;
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO core.app_user (employee_code, full_name, password_hash, must_change_password, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [employeeCode, `Test ${employeeCode}`, await hashPassword(password), mustChangePassword, isActive],
  );
  for (const r of roles) {
    await pool.query('INSERT INTO core.user_role (user_id, role_code, plant_id) VALUES ($1, $2, $3)', [rows[0].id, r.roleCode, r.plantId ?? null]);
  }
  return { id: rows[0].id, employeeCode, password };
}

/** A supertest agent (keeps cookies) signed in as the given user. */
export async function signIn(user) {
  const agent = request.agent(getApp());
  const res = await agent.post('/api/v1/auth/login').send({ employeeCode: user.employeeCode, password: user.password });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function agentWithRoles(roles) {
  const user = await createUser({ roles });
  return { user, agent: await signIn(user) };
}

export const adminAgent = () => agentWithRoles([{ roleCode: 'SYSTEM_ADMIN' }]);

export const api = () => request(getApp());
