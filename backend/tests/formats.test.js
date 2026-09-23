import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { agentWithRoles, plantId, uid } from './helpers.js';

const newItem = async (code = uid('ITM')) => {
  const { rows } = await getPool().query("INSERT INTO mst.item (item_code, description) VALUES ($1, 'Test bracket') RETURNING id, item_code", [code]);
  return rows[0];
};
const incharge = async () => agentWithRoles([{ roleCode: 'IQC_INCHARGE', plantId: await plantId('1115') }]);
const head = async () => agentWithRoles([{ roleCode: 'IQC_HEAD', plantId: await plantId('1115') }]);

const dim = (checkpoint, lsl, usl, extra = {}) => ({ section: 'DIMENSIONAL', checkpoint, specification: `${(lsl + usl) / 2}`, nominal: (lsl + usl) / 2, lsl, usl, uom: 'mm', instrument: 'DVC', ...extra });
const vis = (spec) => ({ section: 'VISUAL', checkpoint: 'Aesthetic', specification: spec, instrument: 'Visual' });

const draft = (agent, itemId, body) => agent.post(`/api/v1/formats/items/${itemId}/drafts`).send(body);
const save = (agent, v, patch) => agent.put(`/api/v1/formats/versions/${v.id}`).send({ formatNo: v.formatNo, commonFormatNo: v.commonFormatNo, refStandard: v.refStandard, checkpoints: v.checkpoints, rowVersion: v.rowVersion, ...patch });
const act = (agent, v, action, extra = {}) => agent.post(`/api/v1/formats/versions/${v.id}/actions`).send({ action, rowVersion: v.rowVersion, ...extra });

/** Creates and approves v1 with five dimensions and one visual check. Returns { item, v1, inch, hd }. */
async function approvedV1() {
  const item = await newItem();
  const inch = await incharge();
  const hd = await head();
  const d = (await draft(inch.agent, item.id, { from: 'BLANK' })).body.data;
  const saved = (await save(inch.agent, d, {
    formatNo: 'F-1',
    checkpoints: [dim('Dim 1', 56.7, 57.3), dim('Dim 2', 22, 22.4), dim('Dim 3', 39.9, 40.5), dim('Dim 4', 13.8, 14.2), dim('Dim 5', 89.5, 90.5), vis('Free from rust')],
  })).body.data;
  const submitted = (await act(inch.agent, saved, 'submit')).body.data.version;
  const approved = (await act(hd.agent, submitted, 'approve')).body.data;
  expect(approved.outcome).toMatchObject({ result: 'APPROVED', versionNo: 1 });
  return { item, v1: approved.version, inch, hd };
}

const cpByName = (v, name) => v.checkpoints.find((c) => c.checkpoint === name);

describe('format lifecycle', () => {
  it('creates, submits and approves the first format; the initiator cannot approve', async () => {
    const item = await newItem();
    const { agent: inch } = await incharge();
    const d = await draft(inch, item.id, { from: 'BLANK' });
    expect(d.status).toBe(201);
    expect(d.body.data).toMatchObject({ status: 'DRAFT', source: 'NEW', baseVersionId: null, refStandard: 'IS 2500', allowedActions: ['edit', 'submit', 'discard'] });

    const saved = await save(inch, d.body.data, { checkpoints: [dim('Dia', 9.9, 10.1), vis('No burr')] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.checkpoints.map((c) => [c.section, c.seq])).toEqual([['DIMENSIONAL', 1], ['VISUAL', 1]]);
    expect(saved.body.data.checkpoints[0].uid).toMatch(/^[0-9a-f-]{36}$/);

    const sub = await act(inch, saved.body.data, 'submit');
    expect(sub.body.data.version.status).toBe('PENDING_APPROVAL');
    expect(sub.body.data.version.allowedActions).toEqual(['discard']);
    expect((await act(inch, sub.body.data.version, 'approve')).status).toBe(403);

    const { agent: hd } = await head();
    const appr = await act(hd, sub.body.data.version, 'approve', { remark: 'OK' });
    expect(appr.body.data.version).toMatchObject({ status: 'APPROVED', versionNo: 1, decisionRemark: 'OK' });

    const lib = await inch.get('/api/v1/formats').query({ q: item.item_code });
    expect(lib.body.data[0]).toMatchObject({ itemCode: item.item_code, versionNo: 1, pendingCount: 0 });
  });

  it('lets an IQC Head create and approve their own format (blueprint case 2)', async () => {
    const item = await newItem();
    const { agent: hd } = await head();
    const d = (await draft(hd, item.id, { from: 'BLANK' })).body.data;
    const s = (await save(hd, d, { checkpoints: [vis('Clean')] })).body.data;
    const p = (await act(hd, s, 'submit')).body.data.version;
    expect(p.allowedActions).toEqual(['discard', 'approve', 'reject']);
    expect((await act(hd, p, 'approve')).body.data.version.status).toBe('APPROVED');
  });

  it('validates content on save and on submit', async () => {
    const item = await newItem();
    const { agent } = await incharge();
    const d = (await draft(agent, item.id, { from: 'BLANK' })).body.data;
    const bad = await save(agent, d, { checkpoints: [{ section: 'DIMENSIONAL', checkpoint: 'Dia', lsl: 5, usl: 4 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.errors).toEqual([{ path: 'checkpoints.0.usl', message: 'USL must not be below LSL.' }]);
    const empty = await act(agent, d, 'submit');
    expect(empty.status).toBe(422);
    expect(empty.body.message).toBe('Add at least one checkpoint before submitting.');
  });

  it('only the owner edits a draft; stale saves are refused; reject needs a reason and returns it for rework', async () => {
    const item = await newItem();
    const { agent: owner } = await incharge();
    const { agent: other } = await incharge();
    const d = (await draft(owner, item.id, { from: 'BLANK' })).body.data;
    expect((await save(other, d, { checkpoints: [vis('x')] })).status).toBe(403);
    const s1 = (await save(owner, d, { checkpoints: [vis('x')] })).body.data;
    expect((await save(owner, d, { checkpoints: [vis('y')] })).body.code).toBe('STALE_VERSION');

    const p = (await act(owner, s1, 'submit')).body.data.version;
    const { agent: hd } = await head();
    expect((await act(hd, p, 'reject')).status).toBe(422);
    const rej = (await act(hd, p, 'reject', { remark: 'Add the weld check' })).body.data.version;
    expect(rej).toMatchObject({ status: 'REJECTED', decisionRemark: 'Add the weld check' });
    const reworked = (await save(owner, rej, { checkpoints: [vis('x'), vis('Weld ground')] })).body.data;
    expect(reworked.status).toBe('DRAFT');
    expect((await act(owner, reworked, 'submit')).body.data.version.status).toBe('PENDING_APPROVAL');
  });
});

describe('Git-style versioning', () => {
  it('reproduces the design scenario: fast-forward, then conflict on Dim 5, resolve, approve as v3', async () => {
    const { item, v1, inch, hd } = await approvedV1();

    // Initiator branches from v1: edits Dim 2 and Dim 5.
    let a = (await draft(inch.agent, item.id, { from: 'CURRENT' })).body.data;
    expect(a.baseVersionId).toBe(v1.id);
    a = (await save(inch.agent, a, { checkpoints: a.checkpoints.map((c) => (c.checkpoint === 'Dim 2' ? { ...c, usl: 22.5 } : c.checkpoint === 'Dim 5' ? { ...c, usl: 90.6 } : c)) })).body.data;

    // Head branches from v1 too: edits Dim 5 differently and adds Visual 3.
    let b = (await draft(hd.agent, item.id, { from: 'CURRENT' })).body.data;
    expect(b.otherOpenDrafts.map((o) => o.id)).toContain(a.id);
    b = (await save(hd.agent, b, { checkpoints: [...b.checkpoints.map((c) => (c.checkpoint === 'Dim 5' ? { ...c, usl: 90.4 } : c)), vis('Weld ground')] })).body.data;

    a = (await act(inch.agent, a, 'submit')).body.data.version;
    b = (await act(hd.agent, b, 'submit')).body.data.version;
    const queue = (await hd.agent.get('/api/v1/formats/queue')).body.data.filter((q) => q.itemId === item.id);
    expect(queue.map((q) => q.id)).toEqual([a.id, b.id]); // oldest submission first

    // A fast-forwards to v2.
    const ff = (await act(hd.agent, a, 'approve')).body.data;
    expect(ff.outcome).toMatchObject({ result: 'APPROVED', versionNo: 2 });

    // B is now behind: preview shows one conflict, then approval parks it in CONFLICT.
    const preview = (await hd.agent.get(`/api/v1/formats/versions/${b.id}/merge-preview`)).body.data;
    expect(preview).toMatchObject({ mode: 'MERGE', againstVersionNo: 2, baseVersionNo: 1 });
    expect(preview.conflicts).toHaveLength(1);
    const conflicted = (await act(hd.agent, b, 'approve')).body.data;
    expect(conflicted.outcome).toMatchObject({ result: 'CONFLICT', conflicts: 1, againstVersionNo: 2 });
    b = conflicted.version;
    expect(b.status).toBe('CONFLICT');
    expect(b.conflicts).toEqual([expect.objectContaining({ field: 'usl', label: 'Dim 5', baseValue: 90.5, theirsValue: 90.6, mineValue: 90.4 })]);
    expect((await act(hd.agent, b, 'approve')).body.code).toBe('MERGE_CONFLICT');

    // Resolve with a custom value; the draft is rebased onto v2 and back in the queue.
    const resolved = await hd.agent.put(`/api/v1/formats/versions/${b.id}/conflicts`).send({
      resolutions: [{ conflictId: b.conflicts[0].id, choice: 'CUSTOM', value: 90.45 }], rowVersion: b.rowVersion,
    });
    expect(resolved.status).toBe(200);
    b = resolved.body.data.version;
    expect(b).toMatchObject({ status: 'PENDING_APPROVAL', baseVersionNo: 2 });
    expect(b.submittedAt).toBe(queue[1].submittedAt);

    const v3 = (await act(hd.agent, b, 'approve')).body.data.version;
    expect(v3).toMatchObject({ status: 'APPROVED', versionNo: 3 });
    expect(cpByName(v3, 'Dim 2').usl).toBe(22.5); // from A
    expect(cpByName(v3, 'Dim 5').usl).toBe(90.45); // resolution
    expect(v3.checkpoints.filter((c) => c.section === 'VISUAL').map((c) => c.specification)).toEqual(['Free from rust', 'Weld ground']); // from B

    const history = (await hd.agent.get(`/api/v1/formats/items/${item.id}`)).body.data;
    expect(history.versions.map((v) => [v.versionNo, v.status])).toEqual([[3, 'APPROVED'], [2, 'SUPERSEDED'], [1, 'SUPERSEDED']]);
    const cmp = (await hd.agent.get('/api/v1/formats/compare').query({ a: v1.id, b: v3.id })).body.data.diff;
    expect(cmp.added.map((c) => c.specification)).toEqual(['Weld ground']);
    expect(cmp.changed.map((c) => c.checkpoint).sort()).toEqual(['Dim 2', 'Dim 5']);
  });

  it('merges automatically when the drafts touch different checkpoints', async () => {
    const { item, inch, hd } = await approvedV1();
    let a = (await draft(inch.agent, item.id, { from: 'CURRENT' })).body.data;
    let b = (await draft(hd.agent, item.id, { from: 'CURRENT' })).body.data;
    a = (await save(inch.agent, a, { checkpoints: a.checkpoints.map((c) => (c.checkpoint === 'Dim 1' ? { ...c, instrument: 'Height gauge' } : c)) })).body.data;
    b = (await save(hd.agent, b, { checkpoints: b.checkpoints.filter((c) => c.checkpoint !== 'Dim 4') })).body.data;
    a = (await act(inch.agent, a, 'submit')).body.data.version;
    b = (await act(hd.agent, b, 'submit')).body.data.version;
    await act(hd.agent, a, 'approve');
    const merged = (await act(hd.agent, b, 'approve')).body.data;
    expect(merged.outcome).toMatchObject({ result: 'APPROVED', versionNo: 3, merged: true });
    expect(merged.version.mergeNote).toBe('Merged with v2 (started from v1).');
    expect(cpByName(merged.version, 'Dim 1').instrument).toBe('Height gauge');
    expect(cpByName(merged.version, 'Dim 4')).toBeUndefined();
  });

  it('asks before replacing when two first drafts were started independently (cases 3–4)', async () => {
    const item = await newItem();
    const { agent: inch } = await incharge();
    const { agent: hd } = await head();
    let a = (await draft(inch, item.id, { from: 'BLANK' })).body.data;
    let b = (await draft(hd, item.id, { from: 'BLANK' })).body.data;
    a = (await act(inch, (await save(inch, a, { checkpoints: [vis('A')] })).body.data, 'submit')).body.data.version;
    b = (await act(hd, (await save(hd, b, { checkpoints: [vis('B')] })).body.data, 'submit')).body.data.version;
    await act(hd, a, 'approve');
    const refused = await act(hd, b, 'approve');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('UNRELATED_DRAFT');
    expect((await hd.get(`/api/v1/formats/versions/${b.id}/merge-preview`)).body.data.mode).toBe('UNRELATED');
    const replaced = (await act(hd, b, 'approve', { mode: 'REPLACE' })).body.data.version;
    expect(replaced).toMatchObject({ versionNo: 2, mergeNote: 'Replaced v1 without merging.' });
  });

  it('copies an older version back (revert) keeping checkpoint identities', async () => {
    const { item, v1, inch, hd } = await approvedV1();
    let a = (await draft(inch.agent, item.id, { from: 'CURRENT' })).body.data;
    a = (await act(inch.agent, (await save(inch.agent, a, { checkpoints: a.checkpoints.slice(0, 2) })).body.data, 'submit')).body.data.version;
    await act(hd.agent, a, 'approve');
    const revert = (await draft(hd.agent, item.id, { from: 'CLONE', cloneFromVersionId: v1.id })).body.data;
    expect(revert.checkpoints.map((c) => c.uid)).toEqual(v1.checkpoints.map((c) => c.uid));
    expect(revert.sourceRef).toMatchObject({ versionId: v1.id, versionNo: 1 });
  });
});

describe('SAN/SIR (mock)', () => {
  it('builds a draft from SAN/SIR data and logs the call', async () => {
    let item = (await getPool().query("SELECT id, item_code FROM mst.item WHERE item_code = '123456'")).rows[0];
    item ??= await newItem('123456');
    const { agent } = await head();
    const preview = await agent.get('/api/v1/formats/san-lookup').query({ vendorCode: 'v001', itemCode: '123456' });
    expect(preview.body.data).toMatchObject({ found: true, reference: 'SAN-MOCK-123456' });

    const d = await draft(agent, item.id, { from: 'SAN', vendorCode: 'V001' });
    expect(d.status).toBe(201);
    expect(d.body.data).toMatchObject({ source: 'SAN', sourceRef: { vendorCode: 'V001', reference: 'SAN-MOCK-123456' } });
    expect(d.body.data.checkpoints).toHaveLength(9);
    expect(d.body.data.checkpoints.find((c) => c.section === 'RELIABILITY')).toMatchObject({ frequencyMonths: 6 });
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM intg.san_lookup_log WHERE item_code = '123456' AND found");
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('explains when SAN/SIR has nothing for the item', async () => {
    const item = await newItem();
    const { agent } = await head();
    const res = await draft(agent, item.id, { from: 'SAN', vendorCode: 'V001' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/SAN\/SIR has no data for vendor V001/);
  });
});

describe('permissions', () => {
  it('lets inspectors view formats but not create them', async () => {
    const item = await newItem();
    const { agent } = await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId() }]);
    expect((await agent.get('/api/v1/formats')).status).toBe(200);
    expect((await draft(agent, item.id, { from: 'BLANK' })).status).toBe(403);
  });
});

describe('bulk import', () => {
  async function workbook(rows) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('For Data');
    ws.addRow(['SR No', 'Item Code', 'Panels', 'Check Points', 'Specification', 'LSL', 'USL', 'Spec UOM', 'Instrument / Method', 'Frequency', 'Item Description']);
    rows.forEach((r, i) => ws.addRow([i + 1, ...r]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('checks a file, imports approved v1 formats, and skips items that already have one', async () => {
    const newCode = uid('IMP');
    const existing = (await approvedV1()).item.item_code;
    const file = await workbook([
      [newCode, 'Dimensional', 'Dimensions', '57 ± 0.3', null, null, 'mm', 'DVC', null, 'Imported bracket'],
      [newCode, 'Dimensional', 'Angle', '90', 89.5, 90.5, '°', 'Bevel Protractor'],
      [newCode, 'Visual', 'Aesthetic', 'Free from burr', null, null, null, 'Visual'],
      [newCode, 'Reliability', 'Static Load Test', '200 kg vertical', null, null, 'kg', 'Static Load Jig', 'Once in Six Months'],
      [existing, 'Visual', 'Aesthetic', 'Clean', null, null, null, 'Visual'],
      [uid('BAD'), 'Weird', 'X', 'Y', null, null, null, null, null, 'Bad item'],
    ]);
    const { agent } = await head();

    const check = await agent.post('/api/v1/formats/import/check').attach('file', file, 'formats.xlsx');
    expect(check.status).toBe(200);
    expect(check.body.data.summary).toMatchObject({ rows: 6, items: 3, ready: 1, skipped: 1, errors: 1, checkpoints: 4 });
    const ready = check.body.data.items.find((i) => i.itemCode === newCode);
    expect(ready.messages.map((m) => m.message)).toEqual(expect.arrayContaining(['New item: it will be added to the item master.', 'Limits read from "57 ± 0.3": 56.7 … 57.3.']));
    expect(ready.checkpoints.find((c) => c.section === 'RELIABILITY').frequencyMonths).toBe(6);
    expect(check.body.data.items.find((i) => i.status === 'ERROR').messages.map((m) => m.message)).toContainEqual(expect.stringMatching(/Section "Weird"/));
    expect((await getPool().query('SELECT 1 FROM mst.item WHERE item_code = $1', [newCode])).rows).toHaveLength(0);

    const imported = await agent.post('/api/v1/formats/import').attach('file', file, 'formats.xlsx');
    expect(imported.body.data.summary).toMatchObject({ imported: 1, skipped: 1, errors: 1 });
    const { rows } = await getPool().query(
      `SELECT v.version_no, v.status, v.source, v.source_ref, (SELECT count(*)::int FROM qms.format_checkpoint c WHERE c.version_id = v.id) AS n
         FROM mst.item i JOIN qms.format f ON f.item_id = i.id JOIN qms.format_version v ON v.id = f.current_version_id WHERE i.item_code = $1`,
      [newCode],
    );
    expect(rows[0]).toMatchObject({ version_no: 1, status: 'APPROVED', source: 'PRE_FED', n: 4, source_ref: { file: 'formats.xlsx', sheet: 'For Data', rows: [2, 5] } });

    const again = await agent.post('/api/v1/formats/import/check').attach('file', file, 'formats.xlsx');
    expect(again.body.data.items.find((i) => i.itemCode === newCode).status).toBe('SKIP');
  });

  it('serves a template that imports cleanly, and rejects non-Excel files', async () => {
    const { agent } = await head();
    const tpl = await agent.get('/api/v1/formats/import/template').buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(tpl.headers['content-type']).toContain('spreadsheetml');
    const check = await agent.post('/api/v1/formats/import/check').attach('file', tpl.body, 'template.xlsx');
    expect(check.body.data.summary.errors).toBe(0);
    const txt = await agent.post('/api/v1/formats/import/check').attach('file', Buffer.from('hello'), 'notes.txt');
    expect(txt.status).toBe(422);
    expect(txt.body.message).toBe('Upload an Excel .xlsx file.');
  });
});
