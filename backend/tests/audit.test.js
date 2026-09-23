import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { MIGRATIONS_DIR, runMigrations } from '../src/db/migrate.js';
import { seedReferenceData } from '../src/db/seed.js';
import { adminAgent, agentWithRoles, plantId, uid } from './helpers.js';

describe('audit trail', () => {
  it('records who changed what, with only the changed fields on update', async () => {
    const { user, agent } = await adminAgent();
    const code = uid('V');
    const v = (await agent.post('/api/v1/masters/vendors').send({ vendorCode: code, name: 'Before' })).body.data;
    await agent.patch(`/api/v1/masters/vendors/${v.id}`).send({ name: 'After', rowVersion: v.rowVersion });

    const res = await agent.get('/api/v1/audit/changes').query({ table: 'mst.vendor', rowPk: String(v.id) });
    expect(res.status).toBe(200);
    const [update, insert] = res.body.data;
    expect(insert).toMatchObject({ operation: 'I', actorId: user.id, actorEmployeeCode: user.employeeCode });
    expect(insert.newData).toMatchObject({ vendor_code: code, name: 'Before' });
    expect(update).toMatchObject({ operation: 'U', actorId: user.id, oldData: { name: 'Before' }, newData: { name: 'After' } });
    expect(update.requestId).toBeTruthy();
  });

  it('never writes password hashes to the audit log', async () => {
    const { agent } = await adminAgent();
    const created = (await agent.post('/api/v1/users').send({ employeeCode: uid('u'), fullName: 'Audit Check', temporaryPassword: 'Welcome2026x', roles: [] })).body.data;
    const { rows } = await getPool().query("SELECT new_data FROM audit.audit_log WHERE table_name = 'core.app_user' AND row_pk = $1", [created.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].new_data.password_hash).toBeUndefined();
    expect(rows[0].new_data.employee_code).toBe(created.employeeCode);
  });

  it('does not log sign-in bookkeeping as data changes, but keeps auth events', async () => {
    const { user, agent } = await agentWithRoles([{ roleCode: 'AUDITOR' }]);
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM audit.audit_log WHERE table_name = 'core.app_user' AND row_pk = $1 AND operation = 'U'", [user.id]);
    expect(rows[0].n).toBe(0);
    const events = await agent.get('/api/v1/audit/auth-events').query({ actorId: user.id });
    expect(events.body.data.map((e) => e.event)).toContain('LOGIN_OK');
  });

  it('bounds searches to at most 92 days and needs audit.view', async () => {
    const { agent } = await adminAgent();
    const wide = await agent.get('/api/v1/audit/changes').query({ from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' });
    expect(wide.status).toBe(422);
    const { agent: inspector } = await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId() }]);
    expect((await inspector.get('/api/v1/audit/changes')).status).toBe(403);
    expect((await agent.get('/api/v1/audit/tables')).body.data).toEqual(expect.arrayContaining(['core.app_user', 'mst.item', 'core.number_series']));
  });
});

describe('migrations', () => {
  it('are idempotent, and reference seeding keeps changes made in the app', async () => {
    const pool = getPool();
    expect(await runMigrations(pool)).toEqual([]);
    await pool.query("DELETE FROM core.role_permission WHERE role_code = 'PLANT_OPS_HEAD' AND permission_key = 'reports.view'");
    await seedReferenceData(pool);
    const { rows } = await pool.query("SELECT 1 FROM core.role_permission WHERE role_code = 'PLANT_OPS_HEAD' AND permission_key = 'reports.view'");
    expect(rows).toHaveLength(0);
    const { rows: plants } = await pool.query('SELECT count(*)::int AS n FROM core.plant');
    expect(plants[0].n).toBe(7);
  });

  it('refuse to run when an applied migration file was edited', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'qmas-mig-'));
    try {
      cpSync(MIGRATIONS_DIR, dir, { recursive: true });
      writeFileSync(path.join(dir, '0003_masters.sql'), '-- edited\nSELECT 1;');
      await expect(runMigrations(getPool(), { dir })).rejects.toThrow('Migration 0003_masters.sql was changed after it was applied');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('store business dates in IST', async () => {
    const { rows } = await getPool().query('SHOW TimeZone');
    expect(rows[0].TimeZone).toBe('Asia/Kolkata');
  });
});
