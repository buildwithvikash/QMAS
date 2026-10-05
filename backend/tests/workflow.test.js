import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { runAutoClose, runEscalationTimeouts } from '../src/modules/deviation/deviation.service.js';
import { adminAgent, agentWithRoles, plantId, uid } from './helpers.js';
import { approveFormat, cellsFor, inspector, inwardLot } from './lots.js';

const HOUR = 3_600_000;
const A = {}; // agents by role

beforeAll(async () => {
  const p = await plantId('1115');
  const other = await plantId('1111');
  const as = async (roleCode, plant = p) => (await agentWithRoles([{ roleCode, plantId: plant }])).agent;
  A.inspector = (await inspector()).agent;
  A.incharge = await as('IQC_INCHARGE');
  A.otherIncharge = await as('IQC_INCHARGE', other);
  A.head = await as('IQC_HEAD');
  A.scm = await as('SCM_REQUESTOR');
  A.scmSub = await as('SCM_SUB_HEAD');
  A.vd = await as('VD_REQUESTOR');
  A.vdSub = await as('VD_SUB_HEAD', null);
  A.vdHead = await as('VD_HEAD', null);
  A.plantHead = await as('PLANT_HEAD');
  A.cqa = await as('CQA_HEAD', null);
  A.pdc = await as('PDC_HEAD', null);
  A.ops = await as('CENTRAL_OPS_HEAD', null);
  A.admin = (await adminAgent()).agent;
});

/** An approved format, an inward lot of 2 and a submitted inspection (failed by default: sample 1 is 10.2 mm). */
async function submittedLot({ pass = false } = {}) {
  const itemCode = uid('WF');
  await approveFormat(itemCode);
  const { imirId } = await inwardLot({ itemCode, qty: 40 });
  let m = (await A.inspector.get(`/api/v1/imirs/${imirId}`)).body.data;
  const dims = Array.from({ length: m.sampleSize }, (_, i) => (i === 0 && !pass ? 10.2 : 10));
  const vis = Array.from({ length: m.sampleSize }, () => true);
  m = (await A.inspector.put(`/api/v1/imirs/${imirId}/inspection`).send({ model: 'FR-1', cells: [...cellsFor(m, 'DIMENSIONAL', dims), ...cellsFor(m, 'VISUAL', vis)] })).body.data;
  const sub = await A.inspector.post(`/api/v1/imirs/${imirId}/actions`).send({ action: 'submit', rowVersion: m.rowVersion });
  expect(sub.status).toBe(200);
  return sub.body.data;
}

/** Posts an IMIR action with the current rowVersion. */
async function imirAct(agent, id, payload) {
  const cur = (await agent.get(`/api/v1/imirs/${id}`)).body.data;
  return agent.post(`/api/v1/imirs/${id}/actions`).send({ rowVersion: cur.rowVersion, ...payload });
}

async function devAct(agent, id, payload) {
  const cur = (await agent.get(`/api/v1/deviations/${id}`)).body.data;
  return agent.post(`/api/v1/deviations/${id}/actions`).send({ rowVersion: cur.rowVersion, ...payload });
}

const ok = (res) => {
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};

/** A failed lot escalated by the Incharge and held by the IQC Head (sent to SCM and VD); `department` accepts it. */
async function heldLot(department = 'SCM', suggestedActions = ['SEGREGATION']) {
  const m = await submittedLot();
  ok(await imirAct(A.incharge, m.id, { action: 'escalate', remark: 'Dia over size' }));
  const held = ok(await imirAct(A.head, m.id, { action: 'hold', remark: 'Hold for deviation', suggestedActions }));
  if (department) ok(await devAct(department === 'SCM' ? A.scm : A.vd, held.deviation.id, { action: 'accept' }));
  return { imirId: m.id, devId: held.deviation.id, imir: held };
}

const FORM = { severity: 'MAJOR', action: 'SEGREGATION', deviationQty: 40, correction: 'Segregate over-size parts', correctiveAction: 'Vendor to recalibrate press tool' };

/** A deviation filled by the SCM initiator and approved by the Sub-Head: at IQC Head final. */
async function atFinal(form = FORM) {
  const { imirId, devId } = await heldLot('SCM', [form.action]);
  ok(await devAct(A.scm, devId, { action: 'submit_form', form }));
  ok(await devAct(A.scmSub, devId, { action: 'dept_approve' }));
  return { imirId, devId };
}

const tasksOf = async (agent) => ok(await agent.get('/api/v1/tasks/me'));

describe('deviation form export', () => {
  it('gives the Deviation Form as PDF and Excel, with the chosen severity and action marked', async () => {
    const { devId } = await atFinal();
    const d = ok(await A.head.get(`/api/v1/deviations/${devId}`));
    const buf = (res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); };
    const pdf = await A.head.get(`/api/v1/deviations/${devId}/pdf`).buffer(true).parse(buf);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const xlsx = await A.head.get(`/api/v1/deviations/${devId}/xlsx`).buffer(true).parse(buf);
    expect(xlsx.headers['content-disposition']).toBe(`attachment; filename="${d.deviationNo}.xlsx"`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    const texts = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => { if (!c.isMerged || c.master.address === c.address) texts.push(c.text); }));
    expect(texts.some((t) => t.includes(`DEVIATION FORM NO: ${d.deviationNo}`))).toBe(true);
    expect(texts).toContain('[X] SEGREGATION');
    expect(texts.some((t) => t.includes('[X] MAJOR'))).toBe(true);
    expect((await A.head.get(`/api/v1/deviations/${devId}/doc`)).status).toBe(422);
  });
});

describe('Incharge review', () => {
  it('approves a passed lot and records the history', async () => {
    const m = await submittedLot({ pass: true });
    expect(m.allowedActions).toEqual([]);
    const seen = ok(await A.incharge.get(`/api/v1/imirs/${m.id}`));
    expect(seen.allowedActions).toEqual(['approve', 'reject', 'revert', 'escalate']);
    expect((await tasksOf(A.incharge)).some((t) => t.id === m.id && t.task === 'Review inspection')).toBe(true);

    const done = ok(await imirAct(A.incharge, m.id, { action: 'approve', remark: 'Fine' }));
    expect(done).toMatchObject({ status: 'CLOSED_ACCEPTED', allowedActions: [] });
    expect(done.closedAt).toBeTruthy();
    expect(done.history.map((h) => h.action)).toEqual(['SUBMIT', 'APPROVE']);
    expect(done.history[1]).toMatchObject({ actingRole: 'IQC_INCHARGE', fromStatus: 'SUBMITTED', toStatus: 'CLOSED_ACCEPTED', remark: 'Fine' });
    expect((await tasksOf(A.incharge)).some((t) => t.id === m.id)).toBe(false);
  });

  it('approves a failed lot only with a final approval remark, and only the plant\'s own Incharge may review', async () => {
    const m = await submittedLot();
    expect(ok(await A.incharge.get(`/api/v1/imirs/${m.id}`)).allowedActions).toEqual(['approve', 'reject', 'revert', 'escalate']);
    const bad = await imirAct(A.incharge, m.id, { action: 'approve' });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toBe('Enter the final approval remark: why this failed lot is accepted.');
    expect((await imirAct(A.otherIncharge, m.id, { action: 'escalate', remark: 'x' })).status).toBe(403);
    expect((await imirAct(A.inspector, m.id, { action: 'escalate', remark: 'x' })).status).toBe(403);
    expect((await imirAct(A.head, m.id, { action: 'hold', remark: 'x', department: 'SCM', suggestedActions: ['UAI'] })).status).toBe(409);
    const stale = await A.incharge.post(`/api/v1/imirs/${m.id}/actions`).send({ action: 'escalate', remark: 'x', rowVersion: 1 });
    expect(stale.body.code).toBe('STALE_VERSION');
    const done = ok(await imirAct(A.incharge, m.id, { action: 'approve', remark: 'Over size within functional limits' }));
    expect(done.status).toBe('CLOSED_ACCEPTED');
    expect(done.history.at(-1)).toMatchObject({ action: 'APPROVE', remark: 'Over size within functional limits', payload: { result: 'NOK' } });
  });

  it('the Incharge rejects a lot; a DN can then be raised', async () => {
    const m = await submittedLot();
    expect((await imirAct(A.incharge, m.id, { action: 'reject' })).status).toBe(422); // reason required
    const done = ok(await imirAct(A.incharge, m.id, { action: 'reject', remark: 'Dia over size, return to vendor' }));
    expect(done).toMatchObject({ status: 'CLOSED_REJECTED' });
    expect(done.closedAt).toBeTruthy();
    expect(done.history.at(-1)).toMatchObject({ action: 'REJECT', actingRole: 'IQC_INCHARGE', toStatus: 'CLOSED_REJECTED' });
    expect(ok(await A.incharge.get(`/api/v1/imirs/${m.id}`)).allowedActions).toContain('raise_dn');
  });

  it('sends a lot back to the inspector, who corrects and resubmits it', async () => {
    const m = await submittedLot();
    const dimUid = m.checkpoints.find((c) => c.section === 'DIMENSIONAL').uid;
    const back = ok(await imirAct(A.incharge, m.id, { action: 'revert', remark: 'Re-measure sample 1', checkpointRemarks: [{ checkpointUid: dimUid, remark: 'Check S1' }] }));
    expect(back).toMatchObject({ status: 'IN_INSPECTION', result: null });
    expect(back.checkpoints.find((c) => c.uid === dimUid).inchargeRemark).toBe('Check S1');

    let again = ok(await A.inspector.put(`/api/v1/imirs/${m.id}/inspection`).send({ cells: [{ checkpointUid: dimUid, sampleNo: 1, value: 10 }] }));
    again = ok(await A.inspector.post(`/api/v1/imirs/${m.id}/actions`).send({ action: 'submit', rowVersion: again.rowVersion }));
    expect(again).toMatchObject({ status: 'SUBMITTED', result: 'OK' });
    expect(again.history.map((h) => h.action)).toEqual(['SUBMIT', 'REVERT', 'SUBMIT']);
  });

  it('IQC Head approves an escalated lot', async () => {
    const m = await submittedLot();
    ok(await imirAct(A.incharge, m.id, { action: 'escalate', remark: 'Over size' }));
    expect(ok(await A.head.get(`/api/v1/imirs/${m.id}`)).allowedActions).toEqual(['head_approve', 'hold']);
    expect((await tasksOf(A.head)).find((t) => t.id === m.id)).toMatchObject({ task: 'Decide on escalated lot', actions: ['head_approve', 'hold'] });
    const done = ok(await imirAct(A.head, m.id, { action: 'head_approve', remark: 'Within functional limits' }));
    expect(done.status).toBe('CLOSED_ACCEPTED');
  });
});

describe('deviation through the department', () => {
  it('runs hold → accept → form → send back → approve → final approve → quantities → closed', async () => {
    const { imirId, devId, imir } = await heldLot(null, ['SEGREGATION', 'REWORK']);
    expect(imir).toMatchObject({ status: 'DEPT_REVIEW', deviation: { department: null, stage: 'INITIATOR' } });
    // Offered to both departments: either may accept; the first one owns it.
    expect((await tasksOf(A.scm)).find((t) => t.id === devId)).toMatchObject({ task: 'Waiting for SCM / VD to accept', actions: ['accept'] });
    expect((await tasksOf(A.vd)).find((t) => t.id === devId)).toMatchObject({ actions: ['accept'] });
    expect(ok(await A.scm.get(`/api/v1/deviations/${devId}`))).toMatchObject({ allowedActions: ['accept'], acceptDepartments: ['SCM'] });
    expect((await devAct(A.scm, devId, { action: 'submit_form', form: FORM })).status).toBe(403); // accept first
    expect((await devAct(A.scm, devId, { action: 'accept', department: 'VD' })).status).toBe(403);
    let d = ok(await devAct(A.scm, devId, { action: 'accept' }));
    expect(d).toMatchObject({ department: 'SCM', stage: 'INITIATOR', allowedActions: ['submit_form', 'recommend_reject'] });
    expect(d.acceptedAt).toBeTruthy();
    expect((await devAct(A.vd, devId, { action: 'accept' })).status).toBe(409); // already taken
    expect((await tasksOf(A.vd)).some((t) => t.id === devId)).toBe(false);
    d = ok(await A.scm.get(`/api/v1/deviations/${devId}`));
    expect(d.deviationNo).toMatch(/^DEV1115\d{4}\d{3}$/);
    expect(d).toMatchObject({ suggestedActions: ['SEGREGATION', 'REWORK'], holdRemark: 'Hold for deviation', specification: 'Dia: 10 ± 0.1', allowedActions: ['submit_form', 'recommend_reject'] });
    expect(d.iqcObservation).toBe('Dia: S1 10.2 mm');
    expect((await tasksOf(A.scm)).some((t) => t.id === devId && t.task === 'Department initiator')).toBe(true);

    // The other department cannot act on it.
    expect((await devAct(A.vd, devId, { action: 'submit_form', form: FORM })).status).toBe(403);
    const tooMuch = await devAct(A.scm, devId, { action: 'submit_form', form: { ...FORM, deviationQty: 41 } });
    expect(tooMuch.status).toBe(422);

    d = ok(await devAct(A.scm, devId, { action: 'submit_form', form: FORM }));
    expect(d).toMatchObject({ stage: 'SUB_HEAD', imirStatus: 'DEPT_REVIEW', approvalLevels: ['SUB_HEAD'], severity: 'MAJOR', action: 'SEGREGATION', deviationQty: 40 });
    expect((await devAct(A.scm, devId, { action: 'dept_approve' })).status).toBe(403); // Sub-Head's step
    expect((await devAct(A.scm, devId, { action: 'enter_qty', okQty: 1, notOkQty: 0 })).status).toBe(409); // wrong stage

    d = ok(await devAct(A.scmSub, devId, { action: 'send_back', remark: 'Add vendor containment' }));
    expect(d.stage).toBe('INITIATOR');
    d = ok(await devAct(A.scm, devId, { action: 'submit_form', form: { ...FORM, correctiveAction: 'Vendor containment and press tool recalibration' } }));
    expect(d.revisions.map((r) => r.revisionNo)).toEqual([1, 2]);
    d = ok(await devAct(A.scmSub, devId, { action: 'dept_approve', remark: 'OK' }));
    expect(d).toMatchObject({ stage: 'FINAL', deptOutcome: 'APPROVED', imirStatus: 'IQC_HEAD_FINAL' });
    expect(ok(await A.head.get(`/api/v1/deviations/${devId}`)).allowedActions).toEqual(['final_approve', 'final_reject', 'escalate']);

    const before = Date.now();
    d = ok(await devAct(A.head, devId, { action: 'final_approve', remark: 'Approved under deviation' }));
    expect(d).toMatchObject({ stage: 'UNDER_DEVIATION', finalDecision: 'APPROVED', imirStatus: 'UNDER_DEVIATION' });
    const due = new Date(d.qtyDueAt).getTime() - before;
    expect(due).toBeGreaterThan(13.9 * 24 * HOUR);
    expect(due).toBeLessThan(14.1 * 24 * HOUR);

    const over = await devAct(A.scm, devId, { action: 'enter_qty', okQty: 30, notOkQty: 11 });
    expect(over.status).toBe(422);
    d = ok(await devAct(A.scm, devId, { action: 'enter_qty', okQty: 30, notOkQty: 5 }));
    expect(d).toMatchObject({ stage: 'QTY_VERIFICATION', okQty: 30, notOkQty: 5 });
    d = ok(await devAct(A.head, devId, { action: 'return_qty', remark: 'Count again: 40 received' }));
    expect(d.stage).toBe('UNDER_DEVIATION');
    ok(await devAct(A.scm, devId, { action: 'enter_qty', okQty: 34, notOkQty: 6 }));
    d = ok(await devAct(A.head, devId, { action: 'verify_qty' }));
    expect(d).toMatchObject({ stage: 'CLOSED', outcome: 'ACCEPTED_UNDER_DEVIATION', imirStatus: 'CLOSED_UNDER_DEVIATION', allowedActions: [] });

    const m = ok(await A.inspector.get(`/api/v1/imirs/${imirId}`));
    expect(m.history.map((h) => h.action)).toEqual([
      'SUBMIT', 'ESCALATE', 'HOLD', 'ACCEPT', 'SUBMIT_FORM', 'SEND_BACK', 'SUBMIT_FORM', 'DEPT_APPROVE', 'FINAL_APPROVE', 'ENTER_QTY', 'RETURN_QTY', 'ENTER_QTY', 'VERIFY_QTY',
    ]);
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM audit.audit_log WHERE table_name = $1 AND row_pk = $2', ['qms.deviation', devId]);
    expect(rows[0].n).toBeGreaterThan(5);
  });

  it('Use As Is closes on approval; a department rejection can only be rejected or escalated', async () => {
    const uai = await atFinal({ ...FORM, action: 'UAI' });
    const d = ok(await devAct(A.head, uai.devId, { action: 'final_approve', remark: 'Use as is' }));
    expect(d).toMatchObject({ stage: 'CLOSED', outcome: 'ACCEPTED_UNDER_DEVIATION', imirStatus: 'CLOSED_UNDER_DEVIATION' });

    const { devId } = await heldLot();
    ok(await devAct(A.scm, devId, { action: 'submit_form', form: FORM }));
    ok(await devAct(A.scmSub, devId, { action: 'dept_reject', remark: 'Vendor history poor' }));
    const blocked = await devAct(A.head, devId, { action: 'final_approve', remark: 'x' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('The department did not approve this deviation. Reject it, or escalate it to senior authorities.');
    const r = ok(await devAct(A.head, devId, { action: 'final_reject', remark: 'Return to vendor' }));
    expect(r).toMatchObject({ stage: 'CLOSED', outcome: 'REJECTED', imirStatus: 'CLOSED_REJECTED' });
  });

  it('a recommendation to reject goes to the department Head (approve or send back), then the IQC Head rejects', async () => {
    const { devId } = await heldLot('VD', ['REWORK']);
    let d = ok(await devAct(A.vd, devId, { action: 'recommend_reject', remark: 'Cannot be reworked' }));
    expect(d).toMatchObject({ stage: 'HEAD', deptOutcome: 'REJECT_RECOMMENDED', imirStatus: 'DEPT_REVIEW' });
    expect((await devAct(A.vdSub, devId, { action: 'dept_approve' })).status).toBe(403); // the Head's step
    expect(ok(await A.vdHead.get(`/api/v1/deviations/${devId}`)).allowedActions).toEqual(['dept_approve', 'send_back']);
    expect((await tasksOf(A.vdHead)).some((t) => t.id === devId)).toBe(true);
    d = ok(await devAct(A.vdHead, devId, { action: 'send_back', remark: 'Give the rework trial result' }));
    expect(d).toMatchObject({ stage: 'INITIATOR', deptOutcome: null });
    ok(await devAct(A.vd, devId, { action: 'recommend_reject', remark: 'Rework trial failed' }));
    d = ok(await devAct(A.vdHead, devId, { action: 'dept_approve', remark: 'Agree' }));
    expect(d).toMatchObject({ stage: 'FINAL', deptOutcome: 'REJECT_RECOMMENDED', imirStatus: 'IQC_HEAD_FINAL' });
    expect(ok(await A.head.get(`/api/v1/deviations/${devId}`)).allowedActions).toEqual(['final_reject']);
    d = ok(await devAct(A.head, devId, { action: 'final_reject', remark: 'Rejected as recommended' }));
    expect(d).toMatchObject({ stage: 'CLOSED', outcome: 'REJECTED', imirStatus: 'CLOSED_REJECTED' });
  });

  it('only the user who accepted the deviation works on it', async () => {
    const { devId } = await heldLot('SCM');
    const scm2 = (await agentWithRoles([{ roleCode: 'SCM_REQUESTOR', plantId: await plantId('1115') }])).agent;
    expect(ok(await scm2.get(`/api/v1/deviations/${devId}`)).allowedActions).toEqual([]);
    expect((await devAct(scm2, devId, { action: 'submit_form', form: FORM })).status).toBe(403);
  });

  it('follows the configured approval chain for forms submitted after a change', async () => {
    const chains = ok(await A.admin.get('/api/v1/masters/dept-approval-chains'));
    const vd = chains.find((c) => c.department === 'VD');
    const wrong = await A.admin.put('/api/v1/masters/dept-approval-chains/VD').send({ levels: ['HEAD', 'SUB_HEAD'], rowVersion: vd.rowVersion });
    expect(wrong.status).toBe(422);
    const set = ok(await A.admin.put('/api/v1/masters/dept-approval-chains/VD').send({ levels: ['SUB_HEAD', 'HEAD'], rowVersion: vd.rowVersion }));
    try {
      const { devId } = await heldLot('VD', ['REWORK']);
      let d = ok(await devAct(A.vd, devId, { action: 'submit_form', form: { ...FORM, action: 'REWORK' } }));
      expect(d).toMatchObject({ stage: 'SUB_HEAD', approvalLevels: ['SUB_HEAD', 'HEAD'] });
      expect((await devAct(A.vdHead, devId, { action: 'dept_approve' })).status).toBe(403);
      d = ok(await devAct(A.vdSub, devId, { action: 'dept_approve' }));
      expect(d.stage).toBe('HEAD');
      expect((await tasksOf(A.vdHead)).some((t) => t.id === devId)).toBe(true);
      d = ok(await devAct(A.vdHead, devId, { action: 'dept_approve' }));
      expect(d).toMatchObject({ stage: 'FINAL', deptOutcome: 'APPROVED' });
    } finally {
      await A.admin.put('/api/v1/masters/dept-approval-chains/VD').send({ levels: ['SUB_HEAD'], rowVersion: set.rowVersion });
    }
  });
});

describe('senior escalation', () => {
  it('parallel decisions: the highest authority wins, CQA waits for PDC, and an override is final', async () => {
    const { devId } = await atFinal();
    let d = ok(await devAct(A.head, devId, { action: 'escalate', remark: 'Recurring issue', authorities: ['PLANT_HEAD', 'CQA_HEAD', 'PDC_HEAD'] }));
    expect(d).toMatchObject({ stage: 'SENIOR', imirStatus: 'SENIOR_ESCALATION' });
    expect(d.rounds[0].steps.map((s) => s.roleCode)).toEqual(['CQA_HEAD', 'PDC_HEAD', 'PLANT_HEAD']);
    expect((await tasksOf(A.plantHead)).some((t) => t.id === devId)).toBe(true);
    expect((await A.head.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'senior_decide', decision: 'APPROVE', remark: 'x' })).status).toBe(403);

    d = ok(await A.plantHead.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'senior_decide', decision: 'APPROVE', remark: 'Production needs it' }));
    expect(d.stage).toBe('SENIOR');
    expect(d.rounds[0].resolution).toMatchObject({ effective: 'APPROVE', complete: false });
    d = ok(await A.cqa.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'senior_decide', decision: 'REJECT', remark: 'Safety-relevant dimension' }));
    expect(d.stage).toBe('SENIOR');
    expect(d.rounds[0].resolution).toMatchObject({ effective: 'REJECT', pendingPdc: true });
    d = ok(await A.pdc.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'senior_decide', decision: 'APPROVE', remark: 'Recorded' }));
    expect(d).toMatchObject({ stage: 'FINAL', seniorEffective: 'REJECT' });
    expect(d.rounds[0]).toMatchObject({ status: 'COMPLETE', effectiveDecision: 'REJECT', decidedByRole: 'CQA_HEAD' });
    expect(d.rounds[0].decisions).toHaveLength(3);
    expect(ok(await A.head.get(`/api/v1/deviations/${devId}`)).allowedActions).toEqual(['final_reject']);

    // Rule 4: Central Operations Head overrides after the round.
    d = ok(await A.ops.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'override', decision: 'APPROVE', remark: 'Line stoppage risk; approved with 100% segregation' }));
    expect(d).toMatchObject({ stage: 'FINAL', seniorEffective: 'APPROVE' });
    expect(ok(await A.head.get(`/api/v1/deviations/${devId}`)).allowedActions).toEqual(['final_approve']);
    expect((await devAct(A.head, devId, { action: 'final_reject', remark: 'x' })).status).toBe(409);
    d = ok(await devAct(A.head, devId, { action: 'final_approve', remark: 'Per override' }));
    expect(d.stage).toBe('UNDER_DEVIATION');
    await expect(getPool().query('DELETE FROM qms.escalation_decision WHERE round_id = $1', [d.rounds[0].id])).rejects.toThrow(/cannot be changed or deleted/);
  });

  it('the Operations Head times out after 24 hours, CQA is added, and a change of type returns to the department', async () => {
    const { devId, imirId } = await atFinal();
    let d = ok(await devAct(A.head, devId, { action: 'escalate', remark: 'Needs ops call', authorities: ['CENTRAL_OPS_HEAD', 'PLANT_HEAD'] }));
    const due = new Date(d.rounds[0].steps.find((s) => s.roleCode === 'CENTRAL_OPS_HEAD').dueAt).getTime();
    expect(due - Date.now()).toBeGreaterThan(23.9 * HOUR);

    expect((await runEscalationTimeouts({ now: new Date(Date.now() + 23 * HOUR) })).changed).toBe(0);
    expect((await runEscalationTimeouts({ now: new Date(Date.now() + 25 * HOUR) })).changed).toBeGreaterThanOrEqual(1);
    d = ok(await A.cqa.get(`/api/v1/deviations/${devId}`));
    expect(d.rounds[0].steps.map((s) => [s.roleCode, s.status, s.reason])).toEqual([
      ['CENTRAL_OPS_HEAD', 'TIMED_OUT', 'SELECTED'], ['CQA_HEAD', 'PENDING', 'AUTO_CQA'], ['PLANT_HEAD', 'PENDING', 'SELECTED'],
    ]);
    expect(d.allowedActions).toEqual(['senior_decide', 'override']);

    d = ok(await A.cqa.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'senior_decide', decision: 'CHANGE_TYPE', remark: 'Rework, not segregation' }));
    expect(d).toMatchObject({ stage: 'INITIATOR', seniorEffective: 'CHANGE_TYPE', imirStatus: 'DEPT_REVIEW' });
    expect(d.rounds[0].steps.find((s) => s.roleCode === 'PLANT_HEAD').status).toBe('NOT_REQUIRED');

    // The department resubmits with the new type; the IQC Head may escalate again (round 2).
    ok(await devAct(A.scm, devId, { action: 'submit_form', form: { ...FORM, action: 'REWORK' } }));
    d = ok(await devAct(A.scmSub, devId, { action: 'dept_approve' }));
    expect(d).toMatchObject({ stage: 'FINAL', seniorEffective: null, action: 'REWORK' });
    d = ok(await devAct(A.head, devId, { action: 'escalate', remark: 'Confirm rework', authorities: ['PLANT_HEAD'] }));
    expect(d.rounds.map((r) => r.roundNo)).toEqual([1, 2]);
    d = ok(await A.plantHead.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'senior_decide', decision: 'APPROVE', remark: 'OK' }));
    expect(d).toMatchObject({ stage: 'FINAL', seniorEffective: 'APPROVE' });

    const m = ok(await A.inspector.get(`/api/v1/imirs/${imirId}`));
    expect(m.history.filter((h) => h.action === 'OPS_TIMEOUT')[0]).toMatchObject({ actorId: null, payload: { timedOut: ['CENTRAL_OPS_HEAD'], added: ['CQA_HEAD'] } });
  });
});

describe('quantity deadline', () => {
  it('auto-closes a deviation whose quantities were not entered within 14 days', async () => {
    const { devId } = await atFinal();
    ok(await devAct(A.head, devId, { action: 'final_approve', remark: 'Segregate' }));
    expect((await runAutoClose({ now: new Date(Date.now() + 13 * 24 * HOUR) })).closed).toBe(0);
    expect((await runAutoClose({ now: new Date(Date.now() + 15 * 24 * HOUR) })).closed).toBeGreaterThanOrEqual(1);
    const d = ok(await A.head.get(`/api/v1/deviations/${devId}`));
    expect(d).toMatchObject({ stage: 'CLOSED', outcome: 'AUTO_CLOSED', imirStatus: 'AUTO_CLOSED' });
  });

  it('lists deviations by stage within the viewer\'s plants', async () => {
    const list = await A.head.get('/api/v1/deviations').query({ open: 'false', department: 'SCM' });
    expect(list.status).toBe(200);
    expect(list.body.data.every((x) => x.stage === 'CLOSED' && x.department === 'SCM')).toBe(true);
    expect((await A.inspector.get('/api/v1/deviations')).status).toBe(403);
  });
});

describe('reversal', () => {
  const reversalOf = async (agent, type, id) => ok(await agent.get(`/api/v1/reversals/record/${type}/${id}`));

  it('the responsible user asks, the admin reverses an IMIR approval, and the audit trail keeps it', async () => {
    const m = await submittedLot({ pass: true });
    ok(await imirAct(A.incharge, m.id, { action: 'approve', remark: 'Fine' }));
    // The Incharge took the last step, so may ask; the inspector may not.
    expect((await reversalOf(A.inspector, 'IMIR', m.id)).canRequest).toBe(false);
    const panel = await reversalOf(A.incharge, 'IMIR', m.id);
    expect(panel).toMatchObject({ canRequest: true, canReview: false, status: 'CLOSED_ACCEPTED', pending: null });
    expect(panel.steps.map((s) => [s.action, s.beforeStatus])).toEqual([['APPROVE', 'SUBMITTED'], ['SUBMIT', 'IN_INSPECTION']]);
    expect((await A.inspector.post('/api/v1/reversals').send({ entityType: 'IMIR', entityId: m.id, reason: 'x' })).status).toBe(403);
    expect((await A.incharge.post('/api/v1/reversals').send({ entityType: 'IMIR', entityId: m.id, reason: ' ' })).status).toBe(422);

    const asked = ok(await A.incharge.post('/api/v1/reversals').send({ entityType: 'IMIR', entityId: m.id, stepId: panel.steps[0].id, reason: 'Approved the wrong lot' }));
    expect(asked.pending).toMatchObject({ state: 'PENDING', statusAtRequest: 'CLOSED_ACCEPTED', reason: 'Approved the wrong lot' });
    expect((await A.incharge.post('/api/v1/reversals').send({ entityType: 'IMIR', entityId: m.id, reason: 'again' })).status).toBe(409);
    expect((await A.incharge.get('/api/v1/reversals')).status).toBe(403);

    const list = ok(await A.admin.get('/api/v1/reversals').query({ state: 'PENDING' }));
    expect(list.some((r) => r.id === asked.pending.id)).toBe(true);
    const req = ok(await A.admin.get(`/api/v1/reversals/${asked.pending.id}`));
    expect(req).toMatchObject({ currentStatus: 'CLOSED_ACCEPTED', requestedStepAction: 'APPROVE' });
    const done = ok(await A.admin.post(`/api/v1/reversals/${asked.pending.id}/approve`).send({ stepId: panel.steps[0].id, remark: 'Reopened for review' }));
    expect(done).toMatchObject({
      state: 'REVERSED', previousStatus: 'CLOSED_ACCEPTED', revertedStatus: 'SUBMITTED', revertedStatusLabel: 'Incharge review', reviewRemark: 'Reopened for review', undoneStepAction: 'APPROVE',
    });
    expect(done.reviewedByName).toBeTruthy();
    expect(done.requestedByName).toBeTruthy();

    const back = ok(await A.incharge.get(`/api/v1/imirs/${m.id}`));
    expect(back).toMatchObject({ status: 'SUBMITTED', closedAt: null, allowedActions: ['approve', 'reject', 'revert', 'escalate'] });
    expect(back.history.map((h) => h.action)).toEqual(['SUBMIT', 'APPROVE', 'REVERSAL_REQUEST', 'REVERSED']);
    expect(back.history.at(-1)).toMatchObject({ fromStatus: 'CLOSED_ACCEPTED', toStatus: 'SUBMITTED', payload: { reason: 'Approved the wrong lot', undoneAction: 'APPROVE' } });
    // The undone step is not offered again; the lot can be decided anew.
    expect((await reversalOf(A.incharge, 'IMIR', m.id)).steps.map((s) => s.action)).toEqual(['SUBMIT']);
    ok(await imirAct(A.incharge, m.id, { action: 'reject', remark: 'Second look: reject' }));
    await expect(getPool().query('UPDATE qms.reversal_request SET reason = $2 WHERE id = $1', [asked.pending.id, 'changed'])).rejects.toThrow(/cannot be changed/);
  });

  it('reverses a deviation to before it was accepted, and an admin can reject a request', async () => {
    const { devId, imirId } = await heldLot('SCM');
    ok(await devAct(A.scm, devId, { action: 'submit_form', form: FORM }));
    // The Sub-Head holds the current step; the SCM initiator took the last one.
    expect((await reversalOf(A.scmSub, 'DEVIATION', devId)).canRequest).toBe(true);
    const panel = await reversalOf(A.scm, 'DEVIATION', devId);
    expect(panel.steps.map((s) => [s.action, s.beforeStatus])).toEqual([['SUBMIT_FORM', 'INITIATOR'], ['ACCEPT', 'UNASSIGNED']]);

    let asked = ok(await A.scm.post('/api/v1/reversals').send({ entityType: 'DEVIATION', entityId: devId, reason: 'Should be VD' }));
    const rejected = ok(await A.admin.post(`/api/v1/reversals/${asked.pending.id}/reject`).send({ remark: 'SCM owns it' }));
    expect(rejected).toMatchObject({ state: 'REJECTED', reviewRemark: 'SCM owns it' });

    asked = ok(await A.scm.post('/api/v1/reversals').send({ entityType: 'DEVIATION', entityId: devId, reason: 'Should be VD, really' }));
    const accept = panel.steps.find((s) => s.action === 'ACCEPT');
    ok(await A.admin.post(`/api/v1/reversals/${asked.pending.id}/approve`).send({ stepId: accept.id }));
    const d = ok(await A.vd.get(`/api/v1/deviations/${devId}`));
    expect(d).toMatchObject({ department: null, stage: 'INITIATOR', initiatorId: null, formSubmittedAt: null, imirStatus: 'DEPT_REVIEW', allowedActions: ['accept'] });
    ok(await devAct(A.vd, devId, { action: 'accept' }));
    const m = ok(await A.inspector.get(`/api/v1/imirs/${imirId}`));
    expect(m.history.filter((h) => h.deviationId).map((h) => h.action)).toEqual(['HOLD', 'ACCEPT', 'SUBMIT_FORM', 'REVERSAL_REQUEST', 'REVERSAL_REJECTED', 'REVERSAL_REQUEST', 'REVERSED', 'ACCEPT']);
  });

  it('a request is refused once the record has moved on', async () => {
    const m = await submittedLot();
    const asked = ok(await A.incharge.post('/api/v1/reversals').send({ entityType: 'IMIR', entityId: m.id, reason: 'Inspector entered the wrong sample' }));
    ok(await imirAct(A.incharge, m.id, { action: 'escalate', remark: 'Over size' }));
    const step = (await reversalOf(A.admin, 'IMIR', m.id)).steps.at(-1);
    const late = await A.admin.post(`/api/v1/reversals/${asked.pending.id}/approve`).send({ stepId: step.id });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('RECORD_MOVED');
  });
});

describe('System Admin', () => {
  it('can act for the department and for any senior authority', async () => {
    const { devId, imirId } = await heldLot();
    let d = ok(await A.admin.get(`/api/v1/deviations/${devId}`));
    expect(d.allowedActions).toEqual(['submit_form', 'recommend_reject']);
    ok(await devAct(A.admin, devId, { action: 'submit_form', form: FORM }));
    d = ok(await devAct(A.admin, devId, { action: 'dept_approve' }));
    expect(d.stage).toBe('FINAL');
    d = ok(await devAct(A.admin, devId, { action: 'escalate', remark: 'Check', authorities: ['PLANT_HEAD', 'CQA_HEAD'] }));
    expect(d.seniorRoles).toEqual(['CQA_HEAD', 'PLANT_HEAD']);
    d = ok(await A.admin.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'senior_decide', roleCode: 'PLANT_HEAD', decision: 'APPROVE', remark: 'For plant head' }));
    expect(d).toMatchObject({ stage: 'SENIOR' });
    d = ok(await A.admin.post(`/api/v1/deviations/${devId}/actions`).send({ action: 'senior_decide', roleCode: 'CQA_HEAD', decision: 'APPROVE', remark: 'For CQA' }));
    expect(d).toMatchObject({ stage: 'FINAL', seniorEffective: 'APPROVE' });
    const m = ok(await A.inspector.get(`/api/v1/imirs/${imirId}`));
    const steps = m.history.filter((h) => h.deviationId && !['HOLD', 'ACCEPT'].includes(h.action)); // accepted by the SCM requestor
    expect(steps.every((h) => !h.actingRole || h.actingRole === 'SYSTEM_ADMIN')).toBe(true);
    expect(steps.find((h) => h.action === 'SENIOR_DECISION').payload.forRole).toBe('PLANT_HEAD');
  });
});
