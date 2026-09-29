import { beforeAll, describe, expect, it } from 'vitest';
import { adminAgent, agentWithRoles, uid } from './helpers.js';

let admin;
const letters = () => uid('').replace(/[^A-Za-z]/g, '').slice(-6) || 'Xyz';

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
  it('lists one permission per AI feature and a separate format import', async () => {
    const keys = (await admin.get('/api/v1/permissions')).body.data.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining([
      'formats.import', 'ai.insights', 'ai.failure_chance', 'ai.imir_summary', 'ai.capa_review', 'ai.root_cause', 'ai.search', 'ai.ask', 'ai.voice_tidy',
    ]));
    expect(keys).not.toContain('ai.assist');
    const admins = (await admin.get('/api/v1/roles')).body.data.find((r) => r.code === 'SYSTEM_ADMIN');
    expect(admins.permissions).toEqual(expect.arrayContaining(['formats.import', 'ai.ask', 'system.monitor', 'support.manage']));
  });

  it('needs formats.import for the Excel import, not formats.approve', async () => {
    const approver = await userWith(['dashboard.view', 'formats.view', 'formats.approve']);
    expect((await approver.get('/api/v1/formats/import/template')).status).toBe(403);
    const importer = await userWith(['dashboard.view', 'formats.view', 'formats.import']);
    expect((await importer.get('/api/v1/formats/import/template')).status).toBe(200);
  });

  it('checks each AI feature on its own', async () => {
    const asker = await userWith(['dashboard.view', 'ai.ask']);
    expect((await asker.post('/api/v1/ai/search').send({ q: 'lots rejected this month' })).status).toBe(403);
    expect((await asker.get('/api/v1/insights/overview')).status).toBe(403);
    const insights = await userWith(['dashboard.view', 'ai.insights']);
    expect((await insights.get('/api/v1/insights/overview')).status).toBe(200);
    expect((await insights.post('/api/v1/ai/chat').send({ messages: [{ role: 'user', content: 'hello' }] })).status).toBe(403);
    // Tidying dictation needs both: being an inspector and the AI permission.
    const inspectorOnly = await userWith(['dashboard.view', 'imir.view', 'imir.inspect']);
    expect((await inspectorOnly.post('/api/v1/ai/observations/tidy').send({ text: 'length five four nine' })).status).toBe(403);
  });
});
