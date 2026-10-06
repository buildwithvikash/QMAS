import { beforeAll, describe, expect, it } from 'vitest';
import { adminAgent, agentWithRoles } from './helpers.js';

let admin;
const letters = () => Array.from({ length: 8 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

/** A custom role holding exactly `permissions`, and a signed-in user with it. */
async function userWith(permissions) {
  const res = await admin.post('/api/v1/roles').send({
    name: `Perm test ${letters()}`, description: 'test', department: 'IT', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, permissions,
  });
  if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return (await agentWithRoles([{ roleCode: res.body.data.code }])).agent;
}

beforeAll(async () => {
  admin = (await adminAgent()).agent;
});

describe('separate permissions', () => {
  it('has no AI permissions, and a separate format import and reversal review', async () => {
    const keys = (await admin.get('/api/v1/permissions')).body.data.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['formats.import', 'workflow.reverse']));
    expect(keys.filter((k) => k.startsWith('ai.'))).toEqual([]);
    const admins = (await admin.get('/api/v1/roles')).body.data.find((r) => r.code === 'SYSTEM_ADMIN');
    expect(admins.permissions).toEqual(expect.arrayContaining(['formats.import', 'system.monitor', 'support.manage', 'workflow.reverse']));
  });

  it('needs formats.import for the Excel import, not formats.approve', async () => {
    const approver = await userWith(['dashboard.view', 'formats.view', 'formats.approve']);
    expect((await approver.get('/api/v1/formats/import/template')).status).toBe(403);
    const importer = await userWith(['dashboard.view', 'formats.view', 'formats.import']);
    expect((await importer.get('/api/v1/formats/import/template')).status).toBe(200);
  });

  it('has no AI or insights endpoints any more', async () => {
    expect((await admin.post('/api/v1/ai/chat').send({ messages: [{ role: 'user', content: 'hello' }] })).status).toBe(404);
    expect((await admin.get('/api/v1/insights/overview')).status).toBe(404);
  });
});
