import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { plantScope } from '../src/modules/auth/access.service.js';
import { adminAgent, agentWithRoles, createUser, plantId, signIn, uid } from './helpers.js';

const newUserBody = async (overrides = {}) => ({
  employeeCode: uid('u'),
  fullName: 'Ravi Patel',
  email: `${uid('r').toLowerCase()}@example.com`,
  temporaryPassword: 'Welcome2026x',
  roles: [{ roleCode: 'IQC_INSPECTOR', plantId: await plantId('1115') }],
  ...overrides,
});

describe('permissions', () => {
  it('returns 403 without users.view and allows read-only auditors to list but not create', async () => {
    const { agent: inspector } = await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId() }]);
    expect((await inspector.get('/api/v1/users')).status).toBe(403);

    const { agent: auditor } = await agentWithRoles([{ roleCode: 'AUDITOR' }]);
    expect((await auditor.get('/api/v1/users')).status).toBe(200);
    expect((await auditor.post('/api/v1/users').send(await newUserBody())).status).toBe(403);
  });

  it('computes plant scope from role view/action scopes', () => {
    const user = {
      assignments: [
        { roleCode: 'IQC_INSPECTOR', plantId: 2, viewScope: 'OWN_PLANT', actionScope: 'PLANT', permissions: ['imir.view', 'imir.inspect'] },
        { roleCode: 'IQC_INSPECTOR', plantId: 3, viewScope: 'OWN_PLANT', actionScope: 'PLANT', permissions: ['imir.view', 'imir.inspect'] },
      ],
    };
    expect(plantScope(user, 'imir.view')).toEqual({ all: false, plantIds: [2, 3] });
    expect(() => plantScope(user, 'imir.review')).toThrow('You do not have permission');

    const head = { assignments: [{ roleCode: 'IQC_HEAD', plantId: 2, viewScope: 'ALL_PLANTS', actionScope: 'PLANT', permissions: ['imir.view', 'imir.head_decide'] }] };
    expect(plantScope(head, 'imir.view', 'view')).toEqual({ all: true });
    expect(plantScope(head, 'imir.head_decide', 'action')).toEqual({ all: false, plantIds: [2] });
  });
});

describe('user management', () => {
  it('creates a user with plant-bound roles; the user must change the temporary password', async () => {
    const { agent } = await adminAgent();
    const body = await newUserBody();
    const res = await agent.post('/api/v1/users').send(body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ employeeCode: body.employeeCode.toUpperCase(), mustChangePassword: true, isActive: true, rowVersion: 1 });
    expect(res.body.data.roles).toEqual([expect.objectContaining({ roleCode: 'IQC_INSPECTOR', plantSapCode: '1115' })]);
    expect(res.body.data.passwordHash).toBeUndefined();

    const newbie = await signIn({ employeeCode: body.employeeCode, password: body.temporaryPassword });
    expect((await newbie.get('/api/v1/auth/me')).body.data.user.mustChangePassword).toBe(true);
  });

  it('explains which role assignment is wrong', async () => {
    const { agent } = await adminAgent();
    const res = await agent.post('/api/v1/users').send(await newUserBody({
      roles: [{ roleCode: 'IQC_HEAD', plantId: null }, { roleCode: 'NOT_A_ROLE', plantId: null }],
    }));
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { path: 'roles.0.plantId', message: 'Plant IQC Head must be assigned to a plant.' },
      { path: 'roles.1.roleCode', message: 'Unknown role NOT_A_ROLE.' },
    ]);
  });

  it('rejects a duplicate employee code with 409', async () => {
    const { agent } = await adminAgent();
    const body = await newUserBody();
    await agent.post('/api/v1/users').send(body);
    const dup = await agent.post('/api/v1/users').send({ ...body, email: null });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/Employee code .* already exists/);
  });

  it('uses optimistic locking on updates', async () => {
    const { agent } = await adminAgent();
    const created = (await agent.post('/api/v1/users').send(await newUserBody())).body.data;
    const first = await agent.patch(`/api/v1/users/${created.id}`).send({ fullName: 'Ravi K. Patel', rowVersion: 1 });
    expect(first.status).toBe(200);
    expect(first.body.data.rowVersion).toBe(2);
    const stale = await agent.patch(`/api/v1/users/${created.id}`).send({ fullName: 'Someone else', rowVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
  });

  it('deactivating a user ends their sessions at once', async () => {
    const { agent } = await adminAgent();
    const victim = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const victimAgent = await signIn(victim);
    expect((await victimAgent.get('/api/v1/users')).status).toBe(200);

    const { rows } = await getPool().query('SELECT row_version FROM core.app_user WHERE id = $1', [victim.id]);
    const res = await agent.patch(`/api/v1/users/${victim.id}`).send({ isActive: false, rowVersion: rows[0].row_version });
    expect(res.status).toBe(200);
    expect((await victimAgent.get('/api/v1/users')).status).toBe(401);
    expect((await victimAgent.post('/api/v1/auth/refresh')).status).toBe(401);
  });

  it('refuses to remove the last active System Admin and self-deactivation', async () => {
    // Make sure this admin is the only active one.
    await getPool().query("UPDATE core.app_user SET is_active = false WHERE id IN (SELECT user_id FROM core.user_role WHERE role_code = 'SYSTEM_ADMIN')");
    const { user, agent } = await adminAgent();
    const me = (await agent.get(`/api/v1/users/${user.id}`)).body.data;
    const res = await agent.put(`/api/v1/users/${user.id}/roles`).send({ roles: [{ roleCode: 'AUDITOR', plantId: null }], rowVersion: me.rowVersion });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/At least one active System Admin/);
    const self = await agent.patch(`/api/v1/users/${user.id}`).send({ isActive: false, rowVersion: me.rowVersion });
    expect(self.body.message).toBe('You cannot deactivate your own account.');
  });

  it('role changes take effect on the next request', async () => {
    const { agent } = await adminAgent();
    const target = await createUser({ roles: [{ roleCode: 'IQC_INSPECTOR', plantId: await plantId() }] });
    const targetAgent = await signIn(target);
    expect((await targetAgent.get('/api/v1/users')).status).toBe(403);
    const { rows } = await getPool().query('SELECT row_version FROM core.app_user WHERE id = $1', [target.id]);
    await agent.put(`/api/v1/users/${target.id}/roles`).send({ roles: [{ roleCode: 'AUDITOR', plantId: null }], rowVersion: rows[0].row_version });
    expect((await targetAgent.get('/api/v1/users')).status).toBe(200);
  });

  it('password reset forces a change and unlock clears the lockout', async () => {
    const { agent } = await adminAgent();
    const target = await createUser();
    await getPool().query("UPDATE core.app_user SET locked_until = now() + interval '1 hour' WHERE id = $1", [target.id]);
    const unlocked = await agent.post(`/api/v1/users/${target.id}/unlock`);
    expect(unlocked.body.data.lockedUntil).toBeNull();

    const reset = await agent.post(`/api/v1/users/${target.id}/reset-password`).send({ temporaryPassword: 'ResetPass2026' });
    expect(reset.body.data.mustChangePassword).toBe(true);
    const relogin = await signIn({ employeeCode: target.employeeCode, password: 'ResetPass2026' });
    expect((await relogin.get('/api/v1/auth/me')).body.data.user.mustChangePassword).toBe(true);
  });

  it('searches and filters the user list with pagination', async () => {
    const { agent } = await adminAgent();
    const body = await newUserBody({ fullName: 'Zubin Unusualname' });
    await agent.post('/api/v1/users').send(body);
    const res = await agent.get('/api/v1/users').query({ q: 'unusualname', pageSize: 5 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5, total: 1 });
    const byPlant = await agent.get('/api/v1/users').query({ plantId: await plantId('1115'), roleCode: 'IQC_INSPECTOR' });
    expect(byPlant.body.data.every((u) => u.roles.some((r) => r.plantSapCode === '1115'))).toBe(true);
  });
});

describe('roles and permissions', () => {
  it('lists roles with grants and lets an admin change a role, but never System Admin', async () => {
    const { agent } = await adminAgent();
    const roles = (await agent.get('/api/v1/roles')).body.data;
    expect(roles.map((r) => r.code)).toContain('CENTRAL_OPS_HEAD');
    expect(roles.find((r) => r.code === 'IQC_INSPECTOR').permissions).toContain('imir.inspect');

    const res = await agent.put('/api/v1/roles/PLANT_OPS_HEAD/permissions').send({ permissions: ['dashboard.view', 'reports.view'] });
    expect(res.body.data.permissions).toEqual(['dashboard.view', 'reports.view']);
    const unknown = await agent.put('/api/v1/roles/PLANT_OPS_HEAD/permissions').send({ permissions: ['nope.nope'] });
    expect(unknown.status).toBe(422);
    const admin = await agent.put('/api/v1/roles/SYSTEM_ADMIN/permissions').send({ permissions: [] });
    expect(admin.status).toBe(422);
  });
});
