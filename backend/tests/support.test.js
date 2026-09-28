import { beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { adminAgent, agentWithRoles } from './helpers.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const ok = (res) => {
  if (res.status >= 300) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};

let admin;
let reporter;
let other;

beforeAll(async () => {
  admin = await adminAgent();
  reporter = await agentWithRoles([{ roleCode: 'SCM_REQUESTOR' }]);
  other = await agentWithRoles([{ roleCode: 'SCM_REQUESTOR' }]);
});

const ticket = {
  kind: 'BUG',
  module: 'Deviation',
  priority: 'HIGH',
  title: 'Save button does nothing',
  description: 'Pressing Save on the deviation form shows no message.',
  steps: '1. Open a deviation\n2. Press Save',
  pageUrl: '/deviations/123',
  clientInfo: { browser: 'Test agent', screen: '1920x1080', language: 'en-IN', online: true },
};

describe('help & support tickets', () => {
  it('lets anyone raise a ticket and keeps it private to the reporter and the support team', async () => {
    const t = ok(await reporter.agent.post('/api/v1/support/tickets').send(ticket));
    expect(t.ticketNo).toMatch(/^HLP-\d{5}$/);
    expect(t).toMatchObject({ status: 'OPEN', kind: 'BUG', priority: 'HIGH', reportedBy: reporter.user.id });
    expect(t.reportedByEmail).toBeUndefined();

    // The support team (System Admin) is told.
    const { rows } = await getPool().query("SELECT 1 FROM core.notification WHERE user_id = $1 AND kind = 'SUPPORT_NEW' AND link = $2", [admin.user.id, `/help/tickets/${t.id}`]);
    expect(rows).toHaveLength(1);

    expect((await other.agent.get(`/api/v1/support/tickets/${t.id}`)).status).toBe(404);
    const mine = ok(await reporter.agent.get('/api/v1/support/tickets?scope=all'));
    expect(mine.every((x) => x.reportedBy === reporter.user.id)).toBe(true);
    expect(ok(await admin.agent.get(`/api/v1/support/tickets?scope=all&q=${t.ticketNo}`)).map((x) => x.id)).toContain(t.id);
    expect((await reporter.agent.get('/api/v1/support/team')).status).toBe(403);

    expect((await reporter.agent.post('/api/v1/support/tickets').send({ ...ticket, title: 'x' })).status).toBe(422);
  });

  it('runs the conversation: internal notes, waiting for the reporter, resolve and close', async () => {
    const t = ok(await reporter.agent.post('/api/v1/support/tickets').send(ticket));
    const team = ok(await admin.agent.get('/api/v1/support/team'));
    expect(team.map((u) => u.id)).toContain(admin.user.id);

    let d = ok(await admin.agent.patch(`/api/v1/support/tickets/${t.id}`).send({ status: 'IN_PROGRESS', assignedTo: admin.user.id, priority: 'CRITICAL' }));
    expect(d).toMatchObject({ status: 'IN_PROGRESS', priority: 'CRITICAL', assignedTo: admin.user.id });

    ok(await admin.agent.post(`/api/v1/support/tickets/${t.id}/comments`).send({ body: 'Looks like the session expired.', internal: true }));
    d = ok(await admin.agent.patch(`/api/v1/support/tickets/${t.id}`).send({ status: 'WAITING', note: 'Which deviation number was it?' }));
    expect(d.status).toBe('WAITING');

    // The reporter never sees internal notes; answering puts the ticket back to the team.
    let seen = ok(await reporter.agent.get(`/api/v1/support/tickets/${t.id}`));
    expect(seen.events.some((e) => e.internal)).toBe(false);
    expect(seen.allowedActions).not.toContain('status');
    seen = ok(await reporter.agent.post(`/api/v1/support/tickets/${t.id}/comments`).send({ body: 'DEV-0042', internal: true }));
    expect(seen.status).toBe('IN_PROGRESS');
    expect(seen.events.at(-2)).toMatchObject({ kind: 'COMMENT', internal: false });

    // Only the team changes priority; the reporter confirms a resolved ticket.
    expect((await reporter.agent.patch(`/api/v1/support/tickets/${t.id}`).send({ priority: 'LOW' })).status).toBe(403);
    ok(await admin.agent.patch(`/api/v1/support/tickets/${t.id}`).send({ status: 'RESOLVED', note: 'Fixed in the next release.' }));
    const n = await getPool().query("SELECT 1 FROM core.notification WHERE user_id = $1 AND kind = 'SUPPORT_STATUS'", [reporter.user.id]);
    expect(n.rowCount).toBeGreaterThan(0);
    d = ok(await reporter.agent.patch(`/api/v1/support/tickets/${t.id}`).send({ status: 'CLOSED' }));
    expect(d.status).toBe('CLOSED');
    expect(d.closedAt).toBeTruthy();
    expect((await reporter.agent.post(`/api/v1/support/tickets/${t.id}/comments`).send({ body: 'one more thing' })).status).toBe(409);

    const counts = ok(await admin.agent.get('/api/v1/support/tickets/counts?scope=all'));
    expect(counts.closed).toBeGreaterThan(0);
  });

  it('stores screenshots for the reporter and the team only', async () => {
    const t = ok(await reporter.agent.post('/api/v1/support/tickets').send(ticket));
    const f = ok(await reporter.agent.post(`/api/v1/support/tickets/${t.id}/attachments`).attach('file', PNG, 'screen.png'));
    expect(f).toMatchObject({ fileName: 'screen.png', mimeType: 'image/png' });
    expect((await reporter.agent.post(`/api/v1/support/tickets/${t.id}/attachments`).attach('file', Buffer.from('hello'), 'a.txt')).status).toBe(422);
    const got = await admin.agent.get(`/api/v1/support/tickets/${t.id}/attachments/${f.id}`).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body, PNG)).toBe(0);
    expect((await other.agent.get(`/api/v1/support/tickets/${t.id}/attachments/${f.id}`)).status).toBe(404);
    expect(ok(await reporter.agent.get(`/api/v1/support/tickets/${t.id}`)).attachments).toHaveLength(1);
  });
});
