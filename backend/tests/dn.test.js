import { beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { runCapaReminders } from '../src/modules/dn/dn.service.js';
import { sendPendingMail } from '../src/modules/notifications/mailer.js';
import { agentWithRoles, plantId, uid } from './helpers.js';
import { imirAct, inspector, ok, submittedLot } from './lots.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const DAY = 86_400_000;
const A = {};
const U = {};

beforeAll(async () => {
  const p = await plantId('1115');
  const as = async (key, roleCode, plant = p) => {
    const { user, agent } = await agentWithRoles([{ roleCode, plantId: plant }]);
    A[key] = agent;
    U[key] = user;
  };
  const insp = await inspector();
  A.inspector = insp.agent;
  U.inspector = insp.user;
  await as('incharge', 'IQC_INCHARGE');
  await as('head', 'IQC_HEAD');
  await as('scm', 'SCM_REQUESTOR');
  // Mail addresses so the outbox is exercised.
  for (const k of ['incharge', 'head']) await getPool().query('UPDATE core.app_user SET email = $2 WHERE id = $1', [U[k].id, `${uid('m').toLowerCase()}@example.com`]);
});

/** A failed lot escalated by the Incharge: a DN can be raised from here. */
async function escalatedLot() {
  const m = await submittedLot(A.inspector);
  ok(await imirAct(A.incharge, m.id, { action: 'escalate', remark: 'Dia over size on sample 1' }));
  return m;
}

const put = async (agent, id, body) => {
  const cur = ok(await agent.get(`/api/v1/dns/${id}`));
  return agent.put(`/api/v1/dns/${id}`).send({ rowVersion: cur.rowVersion, ...body });
};
const act = async (agent, id, body) => {
  const cur = ok(await agent.get(`/api/v1/dns/${id}`));
  return agent.post(`/api/v1/dns/${id}/actions`).send({ rowVersion: cur.rowVersion, ...body });
};
const CAPA = { rootCause: 'Press tool worn', correctiveAction: 'Tool re-ground; first-piece check added', targetDate: '2026-10-15', responsibility: 'Vendor QA' };
const notificationsOf = async (agent) => (await agent.get('/api/v1/notifications')).body;

describe('defect notification', () => {
  it('is raised from an escalated lot, numbered and pre-filled from the failed readings', async () => {
    const early = await submittedLot(A.inspector);
    expect(ok(await A.incharge.get(`/api/v1/imirs/${early.id}`)).allowedActions).not.toContain('raise_dn');
    expect((await A.incharge.post('/api/v1/dns').send({ imirId: early.id })).body.code).toBe('NOT_ESCALATED');

    const m = await escalatedLot();
    expect(ok(await A.incharge.get(`/api/v1/imirs/${m.id}`)).allowedActions).toContain('raise_dn');
    expect((await A.inspector.post('/api/v1/dns').send({ imirId: m.id })).status).toBe(403);

    const before = Date.now();
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: m.id }));
    expect(dn.dnNo).toMatch(/^DN1115IL\d{4}\d{3}$/);
    expect(dn).toMatchObject({
      status: 'OPEN', imirNo: m.imirNo, model: 'FR-1', receivedQty: 40, checkedQty: 8, defectiveQty: 1, capaApplicable: true,
      defect: 'Dia over size on sample 1', allowedActions: ['edit', 'submit_capa'],
    });
    expect(dn.lines).toEqual([{ lineNo: 1, parameter: 'Dia', specification: '10 ± 0.1', observation: 'S1: 10.2 mm' }]);
    const due = new Date(dn.capaDueAt).getTime() - before;
    expect(due).toBeGreaterThan(2.99 * DAY);
    expect(due).toBeLessThan(3.01 * DAY);

    const again = await A.incharge.post('/api/v1/dns').send({ imirId: m.id });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DN_EXISTS');
    const imir = ok(await A.incharge.get(`/api/v1/imirs/${m.id}`));
    expect(imir.dn).toMatchObject({ id: dn.id, dnNo: dn.dnNo, status: 'OPEN' });
    expect(imir.allowedActions).not.toContain('raise_dn');
  });

  it('checks quantities and versions on edit', async () => {
    const m = await escalatedLot();
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: m.id }));
    const bad = await put(A.incharge, dn.id, { defectiveQty: 9 });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toBe('Defective qty cannot exceed checked qty.');
    const zodBad = await put(A.incharge, dn.id, { checkedQty: 5, defectiveQty: 6 });
    expect(zodBad.status).toBe(422);

    const saved = ok(await put(A.incharge, dn.id, {
      correction: 'Lot segregated', defectiveQty: 2,
      lines: [{ parameter: 'Dia', specification: '10 ± 0.1', observation: 'S1: 10.2 mm' }, { parameter: 'Burr', observation: 'Edge burr on 1 part' }],
    }));
    expect(saved).toMatchObject({ correction: 'Lot segregated', defectiveQty: 2 });
    expect(saved.lines.map((l) => l.parameter)).toEqual(['Dia', 'Burr']);
    expect(saved.rowVersion).toBeGreaterThan(dn.rowVersion);
    const stale = await A.incharge.put(`/api/v1/dns/${dn.id}`).send({ rowVersion: dn.rowVersion, correction: 'x' });
    expect(stale.body.code).toBe('STALE_VERSION');

    const off = ok(await put(A.incharge, dn.id, { capaApplicable: false }));
    expect(off).toMatchObject({ capaApplicable: false, capaDueAt: null });
    const on = ok(await put(A.incharge, dn.id, { capaApplicable: true }));
    expect(new Date(on.capaDueAt).getTime()).toBe(new Date(on.dnDate).getTime() + 3 * DAY);
  });

  it('runs the CAPA cycle: submit → resubmit → submit → approve, keeping submitted CAPA files', async () => {
    const m = await escalatedLot();
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: m.id }));

    // Images: photos only, at most four.
    const img = await A.incharge.post(`/api/v1/dns/${dn.id}/attachments`).field('kind', 'IMAGE').attach('file', PNG, 'defect.png');
    expect(img.status).toBe(201);
    expect((await A.incharge.post(`/api/v1/dns/${dn.id}/attachments`).field('kind', 'IMAGE').attach('file', PDF, 'x.pdf')).status).toBe(422);
    for (let i = 0; i < 3; i += 1) expect((await A.incharge.post(`/api/v1/dns/${dn.id}/attachments`).field('kind', 'IMAGE').attach('file', PNG, `p${i}.png`)).status).toBe(201);
    const fifth = await A.incharge.post(`/api/v1/dns/${dn.id}/attachments`).field('kind', 'IMAGE').attach('file', PNG, 'p5.png');
    expect(fifth.body.message).toBe('A DN takes at most 4 images. Remove one first.');
    expect((await A.incharge.delete(`/api/v1/files/${img.body.data.id}`)).status).toBe(204);
    const capaFile = ok(await A.incharge.post(`/api/v1/dns/${dn.id}/attachments`).field('kind', 'CAPA').attach('file', PDF, 'vendor-capa.pdf'));
    const dl = await A.head.get(`/api/v1/files/${capaFile.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');

    const noCapa = await act(A.incharge, dn.id, { action: 'submit_capa' });
    expect(noCapa.status).toBe(422);
    expect((await act(A.head, dn.id, { action: 'submit_capa', capa: CAPA })).status).toBe(403);
    let d = ok(await act(A.incharge, dn.id, { action: 'submit_capa', capa: CAPA, remark: 'Vendor CAPA received' }));
    expect(d).toMatchObject({ status: 'CAPA_SUBMITTED', allowedActions: [] });
    expect(d.capas).toHaveLength(1);
    expect((await put(A.incharge, dn.id, { correction: 'x' })).body.code).toBe('DN_NOT_EDITABLE');
    expect(ok(await A.head.get(`/api/v1/dns/${dn.id}`)).allowedActions).toEqual(['approve_capa', 'resubmit']);
    const headInbox = await notificationsOf(A.head);
    expect(headInbox.data.some((n) => n.title === `DN ${dn.dnNo}: CAPA to review` && n.link === `/dns/${dn.id}`)).toBe(true);

    expect((await act(A.head, dn.id, { action: 'resubmit' })).status).toBe(422); // reason required
    d = ok(await act(A.head, dn.id, { action: 'resubmit', remark: 'Root cause is not verified' }));
    expect(d).toMatchObject({ status: 'OPEN', nextCycleNo: 2 });
    expect(d.capas[0]).toMatchObject({ reviewDecision: 'RESUBMIT', reviewRemark: 'Root cause is not verified' });
    expect((await A.incharge.delete(`/api/v1/files/${capaFile.id}`)).body.message).toBe('This CAPA file was part of a submitted CAPA and is kept as evidence.');
    expect((await notificationsOf(A.incharge)).data.some((n) => n.title === `DN ${dn.dnNo}: CAPA resubmission requested`)).toBe(true);

    ok(await act(A.incharge, dn.id, { action: 'submit_capa', capa: { ...CAPA, rootCause: 'Press tool worn; verified by trial run', closingDate: '2026-10-10' } }));
    d = ok(await act(A.head, dn.id, { action: 'approve_capa', remark: 'CAPA effective' }));
    expect(d).toMatchObject({ status: 'CLOSED', allowedActions: [] });
    expect(d.closedAt).toBeTruthy();
    expect(d.capas.map((c) => c.reviewDecision)).toEqual(['RESUBMIT', 'APPROVED']);
    expect(d.history.map((h) => h.action)).toEqual(['DN_RAISE', 'DN_SUBMIT_CAPA', 'DN_RESUBMIT', 'DN_SUBMIT_CAPA', 'DN_CLOSE']);
    expect((await act(A.head, dn.id, { action: 'approve_capa' })).body.code).toBe('WRONG_STATUS');
  });

  it('closes without CAPA when CAPA does not apply', async () => {
    const m = await escalatedLot();
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: m.id }));
    ok(await put(A.incharge, dn.id, { capaApplicable: false }));
    ok(await act(A.incharge, dn.id, { action: 'submit_capa', remark: 'One-off handling damage' }));
    const d = ok(await act(A.head, dn.id, { action: 'approve_capa' }));
    expect(d).toMatchObject({ status: 'CLOSED', capas: [] });
  });

  it('prints the DN and the IMIR as PDF', async () => {
    const m = await escalatedLot();
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: m.id }));
    await A.incharge.post(`/api/v1/dns/${dn.id}/attachments`).field('kind', 'IMAGE').attach('file', PNG, 'defect.png');
    const buf = (res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); };
    for (const url of [`/api/v1/dns/${dn.id}/pdf`, `/api/v1/imirs/${m.id}/pdf`]) {
      const res = await A.head.get(url).buffer(true).parse(buf);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.body.length).toBeGreaterThan(1500);
    }
  });

  it('reminds about overdue CAPA on the due day and every 2 days after', async () => {
    const m = await escalatedLot();
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: m.id }));
    const count = async () => (await getPool().query("SELECT count(*)::int AS n FROM qms.imir_action WHERE dn_id = $1 AND action = 'CAPA_REMINDER'", [dn.id])).rows[0].n;
    await runCapaReminders({ now: new Date(Date.now() + 2 * DAY) });
    expect(await count()).toBe(0);
    await runCapaReminders({ now: new Date(Date.now() + 3.1 * DAY) });
    expect(await count()).toBe(1);
    await runCapaReminders({ now: new Date(Date.now() + 4 * DAY) });
    expect(await count()).toBe(1);
    await runCapaReminders({ now: new Date(Date.now() + 5.2 * DAY) });
    expect(await count()).toBe(2);
    expect((await notificationsOf(A.incharge)).data.some((n) => n.title === `DN ${dn.dnNo}: vendor CAPA overdue`)).toBe(true);
    expect(ok(await A.head.get('/api/v1/dns').query({ overdue: 'true', q: dn.dnNo }))).toHaveLength(0); // list reads real time: not overdue yet
  });
});

describe('notifications and mail', () => {
  it('tells the next actor, keeps unread counts, and sends queued mail once', async () => {
    const m = await submittedLot(A.inspector);
    let inbox = await notificationsOf(A.incharge);
    const n = inbox.data.find((x) => x.link === `/imirs/${m.id}`);
    expect(n.title).toBe(`IMIR ${m.imirNo} submitted (NOK) — review needed`);
    expect(inbox.meta.unread).toBeGreaterThan(0);
    expect((await A.incharge.post(`/api/v1/notifications/${n.id}/read`)).status).toBe(204);
    expect((await A.head.post(`/api/v1/notifications/${n.id}/read`)).status).toBe(404); // someone else's
    await A.incharge.post('/api/v1/notifications/read-all');
    inbox = await notificationsOf(A.incharge);
    expect(inbox.meta.unread).toBe(0);

    const { rows } = await getPool().query("SELECT id, to_address, subject, body_html FROM core.mail_outbox WHERE to_user_id = $1 AND status = 'PENDING'", [U.incharge.id]);
    const mail = rows.find((r) => r.subject === `[QMAS] IMIR ${m.imirNo} submitted (NOK) — review needed`);
    expect(mail.body_html).toContain(`/imirs/${m.id}`);

    const failing = { sendMail: async () => { throw new Error('SMTP down'); } };
    await sendPendingMail({ transport: failing, limit: 1000 });
    let row = (await getPool().query('SELECT status, attempts, last_error, next_attempt_at FROM core.mail_outbox WHERE id = $1', [mail.id])).rows[0];
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'SMTP down' });
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    const sent = [];
    await sendPendingMail({ transport: { sendMail: async (x) => sent.push(x) }, now: new Date(Date.now() + DAY), limit: 1000 });
    row = (await getPool().query('SELECT status FROM core.mail_outbox WHERE id = $1', [mail.id])).rows[0];
    expect(row.status).toBe('SENT');
    expect(sent.filter((x) => x.subject === mail.subject && x.to === mail.to_address)).toHaveLength(1);
    await sendPendingMail({ transport: { sendMail: async (x) => sent.push(x) }, now: new Date(Date.now() + 2 * DAY), limit: 1000 });
    expect(sent.filter((x) => x.subject === mail.subject && x.to === mail.to_address)).toHaveLength(1);
  });

  it('mails a DN to the signed-in user with the PDF attached', async () => {
    const m = await escalatedLot();
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: m.id }));
    const res = ok(await A.incharge.post(`/api/v1/dns/${dn.id}/mail-self`));
    expect(res.email).toMatch(/@example\.com$/);
    expect((await A.scm.post(`/api/v1/dns/${dn.id}/mail-self`)).status).toBe(403); // SCM cannot see DNs by default
    const sent = [];
    await sendPendingMail({ transport: { sendMail: async (x) => sent.push(x) }, limit: 1000 });
    const mail = sent.find((x) => x.subject === `[QMAS] DN ${dn.dnNo} (PDF attached)`);
    expect(mail.attachments[0]).toMatchObject({ filename: `${dn.dnNo}.pdf`, contentType: 'application/pdf' });
    expect(mail.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('reports and dashboard', () => {
  it('returns registers as JSON or Excel within the viewer\'s plants', async () => {
    const m = await escalatedLot();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const reg = ok(await A.head.get('/api/v1/reports/imir-register').query({ from: '2026-09-01', to: '2026-12-31' }));
    expect(reg.columns[0]).toEqual({ key: 'imirNo', header: 'IMIR', type: 'text' });
    expect(reg.rows.find((r) => r.imirNo === m.imirNo)).toMatchObject({ result: 'NOK', status: 'WITH_IQC_HEAD', inwardQty: 40 });

    const vq = ok(await A.head.get('/api/v1/reports/vendor-quality').query({ from: '2026-09-01', to: '2026-12-31' }));
    const v100 = vq.rows.find((r) => r.vendorCode === 'V100');
    expect(v100.lots).toBeGreaterThan(0);
    expect(typeof v100.inwardQty).toBe('number');

    const ageing = ok(await A.head.get('/api/v1/reports/pending-ageing'));
    expect(ageing.rows.find((r) => r.imirNo === m.imirNo)).toMatchObject({ status: 'WITH_IQC_HEAD', bucket: '0-1 days' });
    expect(ageing.from).toBeNull();
    const dnReg = ok(await A.head.get('/api/v1/reports/dn-register'));
    expect(dnReg.to).toBe(today);

    const xlsx = await A.head.get('/api/v1/reports/deviation-register').query({ format: 'xlsx' }).buffer(true)
      .parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-disposition']).toMatch(/deviation-register_.*\.xlsx/);
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');

    const cov = ok(await A.head.get('/api/v1/reports/format-coverage').query({ from: '2026-09-01', to: '2026-12-31' }));
    expect(cov.rows.find((r) => r.itemCode === m.itemCode)).toMatchObject({ coverage: 'Approved', versionNo: 1, lots: 1, waitingLots: 0, openDraft: null });

    const tat = ok(await A.head.get('/api/v1/reports/tat'));
    const stages = tat.rows.map((r) => r.stage);
    expect(stages.indexOf('Inspection')).toBeLessThan(stages.indexOf('Incharge review'));
    expect(tat.rows.find((r) => r.stage === 'Incharge review').completed).toBeGreaterThan(0);
    expect(tat.rows.find((r) => r.stage === 'IQC Head decision').openNow).toBeGreaterThan(0);

    expect((await A.head.get('/api/v1/reports/nope')).status).toBe(404);
    expect((await A.head.get('/api/v1/reports/imir-register').query({ from: '2026-10-01', to: '2026-09-01' })).status).toBe(422);
    expect((await A.inspector.get('/api/v1/reports/imir-register')).status).toBe(403);
    const list = ok(await A.head.get('/api/v1/reports'));
    expect(list.map((r) => r.key)).toContain('dn-register');
  });

  it('summarises open work for the dashboard', async () => {
    await escalatedLot();
    const s = ok(await A.inspector.get('/api/v1/dashboard/summary'));
    expect(s.imirByStatus.WITH_IQC_HEAD).toBeGreaterThan(0);
    expect(s.lots30Days.received).toBeGreaterThan(0);
    expect(s.dn).toHaveProperty('capaOverdue');
    expect(typeof s.openDeviations).toBe('number');
    expect(s.trend).toHaveLength(30);
    expect(s.trend.at(-1).received).toBeGreaterThan(0);
    expect(s.worstVendors[0]).toMatchObject({ vendorCode: 'V100' });
    expect(s.ageing.find((a) => a.status === 'WITH_IQC_HEAD').d0).toBeGreaterThan(0);
    expect(Array.isArray(s.capaDue)).toBe(true);
  });
});

describe('global search', () => {
  it('finds documents and masters the user may see, within their plants', async () => {
    const m = await escalatedLot();
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: m.id }));
    const groups = ok(await A.head.get('/api/v1/search').query({ q: m.imirNo }));
    expect(groups.find((g) => g.key === 'imir').items[0]).toMatchObject({ title: m.imirNo, link: `/imirs/${m.id}` });
    const byDn = ok(await A.head.get('/api/v1/search').query({ q: dn.dnNo }));
    expect(byDn.find((g) => g.key === 'dn').items[0].link).toBe(`/dns/${dn.id}`);
    const byItem = ok(await A.head.get('/api/v1/search').query({ q: m.itemCode }));
    expect(byItem.find((g) => g.key === 'item').items[0]).toMatchObject({ title: m.itemCode, meta: 'Format approved' });

    const { agent: otherPlant } = await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId('1111') }]);
    const none = ok(await otherPlant.get('/api/v1/search').query({ q: m.imirNo }));
    expect(none.find((g) => g.key === 'imir')).toBeUndefined();
    expect((await A.head.get('/api/v1/search').query({ q: 'x' })).status).toBe(422);
  });
});

describe('dynamic list filters', () => {
  it('filters on any field with any condition, combined with all or any', async () => {
    const m = await escalatedLot();
    const list = async (filter, extra = {}) => A.head.get('/api/v1/imirs').query({ filter: JSON.stringify(filter), pageSize: 200, ...extra });
    const ids = async (filter) => (await list(filter)).body.data.map((r) => r.id);

    expect(await ids({ rules: [{ field: 'imirNo', op: 'equals', value: m.imirNo.toLowerCase() }] })).toEqual([m.id]);
    expect(await ids({ rules: [{ field: 'itemCode', op: 'starts_with', value: m.itemCode.slice(0, 5) }, { field: 'result', op: 'in', value: ['NOK'] }] })).toContain(m.id);
    expect(await ids({ rules: [{ field: 'imirNo', op: 'equals', value: m.imirNo }, { field: 'result', op: 'in', value: ['OK'] }] })).toEqual([]);
    expect(await ids({ mode: 'any', rules: [{ field: 'imirNo', op: 'equals', value: m.imirNo }, { field: 'imirNo', op: 'equals', value: 'nope' }] })).toEqual([m.id]);
    expect(await ids({ rules: [{ field: 'imirNo', op: 'equals', value: m.imirNo }, { field: 'inwardQty', op: 'between', value: [39, 41] }, { field: 'receivedAt', op: 'last_days', value: 2 }, { field: 'hasDeviation', op: 'is', value: false }] })).toEqual([m.id]);
    expect(await ids({ rules: [{ field: 'imirNo', op: 'equals', value: m.imirNo }, { field: 'status', op: 'not_in', value: ['WITH_IQC_HEAD'] }] })).toEqual([]);

    const bad = await list({ rules: [{ field: 'password', op: 'contains', value: 'x' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toBe('"password" cannot be filtered on.');
    expect((await list({ rules: [{ field: 'inwardQty', op: 'contains', value: 'x' }] })).body.message).toBe('"contains" does not apply to number fields.');
    expect((await list({ rules: [{ field: 'status', op: 'in', value: ["x'); DROP TABLE qms.imir;--"] }] })).status).toBe(422);
    expect((await A.head.get('/api/v1/imirs').query({ filter: '{not json' })).status).toBe(422);

    const dns = await A.head.get('/api/v1/dns').query({ filter: JSON.stringify({ rules: [{ field: 'capaApplicable', op: 'is', value: true }] }) });
    expect(dns.status).toBe(200);
    const devs = await A.head.get('/api/v1/deviations').query({ filter: JSON.stringify({ rules: [{ field: 'severity', op: 'in', value: ['MAJOR', 'CRITICAL'] }] }) });
    expect(devs.status).toBe(200);
  });
});
