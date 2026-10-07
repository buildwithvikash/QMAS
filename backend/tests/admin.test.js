import { beforeAll, describe, expect, it } from 'vitest';
import { adminAgent, agentWithRoles, plantId } from './helpers.js';
import { imirAct, inspector, ok, submittedLot } from './lots.js';

// System Admin may stand in for any role, but its dashboard and bell hold the admin's own work:
// reversal requests and help-desk tickets, not every role's lots.
const WORKFLOW_KINDS = ['inspect', 'review', 'deviation', 'capa', 'format'];

let admin;
let incharge;
let insp;
beforeAll(async () => {
  admin = (await adminAgent()).agent;
  incharge = (await agentWithRoles([{ roleCode: 'IQC_INCHARGE', plantId: await plantId('1115') }])).agent;
  insp = (await inspector('1115')).agent;
});

describe('System Admin sees admin work only', () => {
  it('My Tasks has no other role\'s work, while the role itself still gets it', async () => {
    const m = await submittedLot(insp, { pass: true });
    const mine = ok(await admin.get('/api/v1/tasks/me'));
    expect(mine.filter((t) => WORKFLOW_KINDS.includes(t.kind))).toEqual([]);
    expect(ok(await incharge.get('/api/v1/tasks/me')).some((t) => t.kind === 'review' && t.id === m.id)).toBe(true);
  });

  it('a reversal request and a new help-desk ticket are the admin\'s tasks', async () => {
    const m = await submittedLot(insp, { pass: true });
    ok(await imirAct(incharge, m.id, { action: 'approve', remark: 'Fine' }));
    const panel = ok(await incharge.get(`/api/v1/reversals/record/IMIR/${m.id}`));
    ok(await incharge.post('/api/v1/reversals').send({ entityType: 'IMIR', entityId: m.id, stepId: panel.steps[0].id, reason: 'Approved the wrong lot' }));
    const ticket = ok(await insp.post('/api/v1/support/tickets').send({
      kind: 'BUG', module: 'Deviation', priority: 'HIGH', title: 'Photo upload fails', description: 'The upload spinner never stops.',
    }));

    const tasks = ok(await admin.get('/api/v1/tasks/me'));
    expect(tasks.find((t) => t.kind === 'admin' && t.docNo === m.imirNo)).toMatchObject({ link: '/admin/reversals', task: 'Decide reversal request' });
    expect(tasks.find((t) => t.kind === 'support' && t.id === ticket.id)).toMatchObject({ docNo: ticket.ticketNo, urgent: true, task: 'Pick up new ticket' });
    // The Incharge does not get the admin's work.
    expect(ok(await incharge.get('/api/v1/tasks/me')).some((t) => t.kind === 'admin' || t.kind === 'support')).toBe(false);
  });

  it('no follow-up notifications for a lot the admin handled as a stand-in', async () => {
    const m = await submittedLot(admin, { pass: true }); // the admin inspected this lot for the inspector
    ok(await imirAct(incharge, m.id, { action: 'approve', remark: 'Fine' }));
    const bell = ok(await admin.get('/api/v1/notifications?limit=100'));
    const items = bell.items ?? bell.rows ?? bell;
    expect(items.some((n) => n.link === `/imirs/${m.id}`)).toBe(false);
  });
});
