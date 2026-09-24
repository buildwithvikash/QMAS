import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { agentWithRoles, plantId, uid } from './helpers.js';
import { approveFormat, cellsFor, DIM, getAdmin, inspector, inwardLot, REL, VIS } from './lots.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

describe('SAP inward lots → IMIR', () => {
  it('records the lot, adds vendor and item from SAP, and waits until a format is approved', async () => {
    const itemCode = uid('SAP');
    const { imirId, sync } = await inwardLot({ itemCode, vendorCode: 'V-NEW1' });
    expect(sync).toMatchObject({ status: 'OK', fetched: 1, createdLots: 1, openedImirs: 0 });
    const { agent } = await inspector();
    let m = (await agent.get(`/api/v1/imirs/${imirId}`)).body.data;
    expect(m).toMatchObject({ status: 'AWAITING_FORMAT', imirNo: null, vendorCode: 'V-NEW1', itemCode, uom: 'NOS' });
    expect(m.itemCategory.toLowerCase()).toBe('sheet metal'); // matched case-insensitively to an existing category
    expect(m.awaitingReason).toBe(`No approved inspection format for item ${itemCode}.`);
    const { rows } = await getPool().query('SELECT source FROM mst.item WHERE item_code = $1', [itemCode]);
    expect(rows[0].source).toBe('SAP');

    await approveFormat(itemCode);
    m = (await agent.get(`/api/v1/imirs/${imirId}`)).body.data;
    expect(m).toMatchObject({ status: 'OPEN', sampleSize: 8, lotSize: 500, acceptNo: 0, rejectNo: 1, samplingBasis: 'TABLE', formatVersionNo: 1 });
    expect(m.imirNo).toMatch(/^IMIR1115\d{6}\d{3}$/);
    expect(m.checkpoints).toHaveLength(2);
  });

  it('opens at once when the item already has a format, sized by the sampling table', async () => {
    const itemCode = uid('SAP');
    await approveFormat(itemCode);
    const small = await inwardLot({ itemCode, qty: 20 });
    const one = await inwardLot({ itemCode, qty: 1 });
    expect(small.sync.openedImirs).toBe(1);
    const { agent } = await inspector();
    expect((await agent.get(`/api/v1/imirs/${small.imirId}`)).body.data).toMatchObject({ status: 'OPEN', sampleSize: 5 });
    expect((await agent.get(`/api/v1/imirs/${one.imirId}`)).body.data).toMatchObject({ sampleSize: 1, samplingBasis: 'FULL_LOT' });
  });

  it('reports a lot for an unknown plant and retries it once the plant exists', async () => {
    const a = await getAdmin();
    const code = uid('SAP');
    await a.post('/api/v1/integration/sap/mock-lots').send({
      plantSapCode: '9876', itemCode: code, itemDescription: 'X', uom: 'NOS', vendorCode: 'V1', vendorName: 'V', grnNo: 'G', grnDate: '2026-09-23', invoiceNo: 'I', inwardQty: 5,
    });
    const first = (await a.post('/api/v1/integration/sap/sync')).body.data;
    expect(first.status).toBe('PARTIAL');
    expect(first.errors[0].message).toBe('Plant 9876 is not in the plant master.');

    await a.post('/api/v1/masters/plants').send({ sapCode: '9876', shortCode: '98', name: `Test plant ${code}` });
    const second = (await a.post('/api/v1/integration/sap/sync')).body.data;
    expect(second).toMatchObject({ status: 'OK', createdLots: 1 });
    const status = (await a.get('/api/v1/integration/sap/status')).body.data;
    expect(status.mode).toBe('mock');
    expect(status.runs[0].id).toBe(second.runId);
  });
});

describe('inspection', () => {
  it('computes decisions on the server, needs every required cell and the model, then locks', async () => {
    const itemCode = uid('INS');
    await approveFormat(itemCode);
    const { imirId } = await inwardLot({ itemCode, qty: 10 }); // sample 3
    const { agent } = await inspector();
    let m = (await agent.get(`/api/v1/imirs/${imirId}`)).body.data;
    expect(m.allowedActions).toEqual(['inspect']);

    m = (await agent.put(`/api/v1/imirs/${imirId}/inspection`).send({ cells: [...cellsFor(m, 'DIMENSIONAL', [10, 10.1]), ...cellsFor(m, 'VISUAL', [true, true, true])] })).body.data;
    expect(m.status).toBe('IN_INSPECTION');
    expect(m.cells.find((c) => c.value === 10.1).decision).toBe('OK');
    expect(m.evaluation.missing).toEqual([{ checkpointUid: m.checkpoints[0].uid, sampleNo: 3, field: 'value' }]);
    const early = await agent.post(`/api/v1/imirs/${imirId}/actions`).send({ action: 'submit', rowVersion: m.rowVersion });
    expect(early.status).toBe(422);

    m = (await agent.put(`/api/v1/imirs/${imirId}/inspection`).send({ cells: cellsFor(m, 'DIMENSIONAL', [10, 10.1, 9.95]) })).body.data;
    expect(m.allowedActions).toEqual(['inspect']); // model still missing
    m = (await agent.put(`/api/v1/imirs/${imirId}/inspection`).send({ model: 'FR-250', inspectorRemark: 'All good' })).body.data;
    expect(m.allowedActions).toEqual(['inspect', 'submit']);

    const sub = (await agent.post(`/api/v1/imirs/${imirId}/actions`).send({ action: 'submit', rowVersion: m.rowVersion })).body.data;
    expect(sub).toMatchObject({ status: 'SUBMITTED', result: 'OK', defectiveSamples: [], allowedActions: [] });
    const after = await agent.put(`/api/v1/imirs/${imirId}/inspection`).send({ model: 'X' });
    expect(after.status).toBe(409);
    expect(after.body.code).toBe('IMIR_NOT_EDITABLE');
  });

  it('rejects the lot on a single NOK and ignores decisions sent by the client', async () => {
    const itemCode = uid('INS');
    await approveFormat(itemCode);
    const { imirId } = await inwardLot({ itemCode, qty: 2 }); // sample 2
    const { agent } = await inspector();
    let m = (await agent.get(`/api/v1/imirs/${imirId}`)).body.data;
    m = (await agent.put(`/api/v1/imirs/${imirId}/inspection`).send({
      model: 'M1', cells: [...cellsFor(m, 'DIMENSIONAL', [10.2, 10]).map((c) => ({ ...c, decision: 'OK' })), ...cellsFor(m, 'VISUAL', [true, true])],
    })).body.data;
    expect(m.cells.find((c) => c.value === 10.2).decision).toBe('NOK');
    const sub = (await agent.post(`/api/v1/imirs/${imirId}/actions`).send({ action: 'submit', rowVersion: m.rowVersion })).body.data;
    expect(sub).toMatchObject({ result: 'NOK', defectiveSamples: [1] });
  });

  it('validates cells against the checkpoint type', async () => {
    const itemCode = uid('INS');
    await approveFormat(itemCode, [DIM, VIS, REL]);
    const { imirId } = await inwardLot({ itemCode, qty: 2 });
    const { agent } = await inspector();
    const m = (await agent.get(`/api/v1/imirs/${imirId}`)).body.data;
    const [dim, vis, rel] = ['DIMENSIONAL', 'VISUAL', 'RELIABILITY'].map((s) => m.checkpoints.find((c) => c.section === s).uid);
    const bad = async (payload) => (await agent.put(`/api/v1/imirs/${imirId}/inspection`).send(payload)).body.message;
    expect(await bad({ cells: [{ checkpointUid: rel, sampleNo: 1, value: 1 }] })).toBe('Reliability tests take a text observation, not sample readings.');
    expect(await bad({ cells: [{ checkpointUid: vis, sampleNo: 1, value: 1 }] })).toBe('Visual checks take OK or NOK.');
    expect(await bad({ cells: [{ checkpointUid: dim, sampleNo: 1, value: 10.0001 }] })).toBe('Some fields need attention.');
    expect(await bad({ cells: [{ checkpointUid: dim, sampleNo: 9, value: 10 }] })).toBe('Some fields need attention.');
    expect(await bad({ entries: [{ checkpointUid: dim, textObservation: 'x' }] })).toBe('Only reliability tests take a text observation and manual result.');
  });

  it('asks for reliability tests only when due for the item and vendor', async () => {
    const itemCode = uid('REL');
    await approveFormat(itemCode, [DIM, REL]);
    const { agent } = await inspector();
    const first = await inwardLot({ itemCode, vendorCode: 'VR1', qty: 2 });
    let m = (await agent.get(`/api/v1/imirs/${first.imirId}`)).body.data;
    const relUid = m.checkpoints.find((c) => c.section === 'RELIABILITY').uid;
    expect(m.checkpoints.find((c) => c.uid === relUid)).toMatchObject({ isRequired: true, lastTestedAt: null });
    m = (await agent.put(`/api/v1/imirs/${first.imirId}/inspection`).send({
      model: 'M', cells: cellsFor(m, 'DIMENSIONAL', [10, 10]), entries: [{ checkpointUid: relUid, textObservation: 'Held 200 kg, no deformation', manualResult: 'OK' }],
    })).body.data;
    expect((await agent.post(`/api/v1/imirs/${first.imirId}/actions`).send({ action: 'submit', rowVersion: m.rowVersion })).body.data.result).toBe('OK');

    const sameVendor = (await agent.get(`/api/v1/imirs/${(await inwardLot({ itemCode, vendorCode: 'VR1', qty: 2 })).imirId}`)).body.data;
    expect(sameVendor.checkpoints.find((c) => c.uid === relUid)).toMatchObject({ isRequired: false });
    expect(sameVendor.checkpoints.find((c) => c.uid === relUid).lastTestedAt).toBeTruthy();
    const otherVendor = (await agent.get(`/api/v1/imirs/${(await inwardLot({ itemCode, vendorCode: 'VR2', qty: 2 })).imirId}`)).body.data;
    expect(otherVendor.checkpoints.find((c) => c.uid === relUid).isRequired).toBe(true);
  });

  it('keeps each plant\'s lots to its own inspectors', async () => {
    const itemCode = uid('PLT');
    await approveFormat(itemCode);
    const { imirId } = await inwardLot({ itemCode, plant: '1111' });
    const { agent: sanjan } = await inspector('1115');
    expect((await sanjan.get(`/api/v1/imirs/${imirId}`)).status).toBe(404);
    const list = (await sanjan.get('/api/v1/imirs').query({ q: itemCode })).body.data;
    expect(list).toEqual([]);
    const { agent: head } = await agentWithRoles([{ roleCode: 'IQC_HEAD', plantId: await plantId('1115') }]);
    const seen = await head.get(`/api/v1/imirs/${imirId}`);
    expect(seen.status).toBe(200); // IQC Head sees all plants...
    expect(seen.body.data.allowedActions).toEqual([]); // ...but does not inspect
  });
});

describe('photos and PDFs', () => {
  it('attaches files to visual samples only, checks the real type, and serves them back', async () => {
    const itemCode = uid('ATT');
    await approveFormat(itemCode);
    const { imirId } = await inwardLot({ itemCode, qty: 2 });
    const { agent } = await inspector();
    const m = (await agent.get(`/api/v1/imirs/${imirId}`)).body.data;
    const vis = m.checkpoints.find((c) => c.section === 'VISUAL').uid;
    const dim = m.checkpoints.find((c) => c.section === 'DIMENSIONAL').uid;

    const up = await agent.post(`/api/v1/imirs/${imirId}/attachments`).field('checkpointUid', vis).field('sampleNo', '1').attach('file', PNG, 'burr.png');
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ ref: `${vis}:1`, mimeType: 'image/png', fileName: 'burr.png' });
    const file = await agent.get(`/api/v1/files/${up.body.data.id}`);
    expect(file.headers['content-type']).toBe('image/png');

    const fake = await agent.post(`/api/v1/imirs/${imirId}/attachments`).field('checkpointUid', vis).field('sampleNo', '1').attach('file', Buffer.from('not an image'), 'x.png');
    expect(fake.body.message).toBe('Upload a JPEG, PNG or WebP photo, or a PDF.');
    const onDim = await agent.post(`/api/v1/imirs/${imirId}/attachments`).field('checkpointUid', dim).field('sampleNo', '1').attach('file', PNG, 'a.png');
    expect(onDim.body.message).toBe('Photos and PDFs can be attached to visual checks only.');

    const { agent: other } = await inspector('1111');
    expect((await other.get(`/api/v1/files/${up.body.data.id}`)).status).toBe(404);
  });
});

describe('tablets and offline sync', () => {
  async function tablet(plant = '1115') {
    const a = await getAdmin();
    const res = await a.post('/api/v1/devices').send({ deviceCode: uid('TAB-'), name: 'Stores tablet', plantId: await plantId(plant) });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it('checks a lot out to one tablet, applies offline operations once, and submits', async () => {
    const itemCode = uid('SYN');
    await approveFormat(itemCode);
    const { imirId } = await inwardLot({ itemCode, qty: 2 });
    const device = await tablet();
    const other = await tablet();
    const { agent } = await inspector();

    expect((await agent.get(`/api/v1/devices/by-code/${device.deviceCode.toLowerCase()}`)).body.data.id).toBe(device.id);
    const co = (await agent.post('/api/v1/sync/checkout').send({ deviceId: device.id, imirIds: [imirId] })).body.data;
    expect(co.refused).toEqual([]);
    const bundle = co.checkedOut[0];
    expect(bundle).toMatchObject({ id: imirId, checkoutDeviceCode: device.deviceCode, sampleSize: 2 });

    // Web and other tablets are locked out while it is on this tablet.
    const web = await agent.put(`/api/v1/imirs/${imirId}/inspection`).send({ model: 'X' });
    expect(web.body.code).toBe('CHECKED_OUT');
    expect((await agent.post('/api/v1/sync/checkout').send({ deviceId: other.id, imirIds: [imirId] })).body.data.refused[0].reason).toMatch(/Already on tablet/);

    const save = { opId: randomUUID(), type: 'SAVE', imirId, clientTime: '2026-09-23T10:15:00+05:30', payload: { model: 'M9', cells: [...cellsFor(bundle, 'DIMENSIONAL', [10, 10]), ...cellsFor(bundle, 'VISUAL', [true, false])] } };
    const p1 = (await agent.post('/api/v1/sync/push').send({ deviceId: device.id, ops: [save] })).body.data;
    expect(p1.results).toEqual([{ opId: save.opId, outcome: 'ACCEPTED' }]);
    const replay = (await agent.post('/api/v1/sync/push').send({ deviceId: device.id, ops: [save] })).body.data;
    expect(replay.results[0]).toMatchObject({ outcome: 'ACCEPTED', duplicate: true });
    const { rows } = await getPool().query('SELECT client_time FROM qms.imir_observation WHERE imir_id = $1 LIMIT 1', [imirId]);
    expect(rows[0].client_time.toISOString()).toBe('2026-09-23T04:45:00.000Z');

    const submit = { opId: randomUUID(), type: 'SUBMIT', imirId, clientTime: '2026-09-23T10:20:00+05:30', payload: {} };
    const p2 = (await agent.post('/api/v1/sync/push').send({ deviceId: device.id, ops: [submit] })).body.data;
    expect(p2.results[0].outcome).toBe('ACCEPTED');
    expect(p2.imirs[0]).toMatchObject({ status: 'SUBMITTED', result: 'NOK', checkedOut: false });

    const late = { opId: randomUUID(), type: 'SAVE', imirId, clientTime: '2026-09-23T10:25:00+05:30', payload: { model: 'changed' } };
    const p3 = (await agent.post('/api/v1/sync/push').send({ deviceId: device.id, ops: [late] })).body.data;
    expect(p3.results[0]).toMatchObject({ outcome: 'CONFLICT', code: 'IMIR_NOT_EDITABLE' });
  });

  it('lets the Incharge release a lost tablet\'s lots, and refuses deactivated tablets', async () => {
    const itemCode = uid('SYN');
    await approveFormat(itemCode);
    const { imirId } = await inwardLot({ itemCode, qty: 2 });
    const device = await tablet();
    const { agent } = await inspector();
    await agent.post('/api/v1/sync/checkout').send({ deviceId: device.id, imirIds: [imirId] });
    expect((await agent.post('/api/v1/sync/release').send({ imirIds: [imirId] })).status).toBe(403);
    const { agent: incharge } = await agentWithRoles([{ roleCode: 'IQC_INCHARGE', plantId: await plantId('1115') }]);
    expect((await incharge.post('/api/v1/sync/release').send({ imirIds: [imirId] })).body.data.released).toEqual([imirId]);

    const a = await getAdmin();
    const off = await a.patch(`/api/v1/devices/${device.id}`).send({ isActive: false, rowVersion: device.rowVersion });
    expect(off.body.data.isActive).toBe(false);
    const refused = await agent.post('/api/v1/sync/push').send({ deviceId: device.id, ops: [{ opId: randomUUID(), type: 'SAVE', imirId, clientTime: '2026-09-23T10:00:00+05:30', payload: { model: 'x' } }] });
    expect(refused.body.code).toBe('DEVICE_INACTIVE');
  });

  it('does not check out lots of another plant to a tablet', async () => {
    const itemCode = uid('SYN');
    await approveFormat(itemCode);
    const { imirId } = await inwardLot({ itemCode, qty: 2, plant: '1115' });
    const device = await tablet('1111');
    const { agent } = await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId('1115') }, { roleCode: 'IQC_INSPECTOR', plantId: await plantId('1111') }]);
    const res = (await agent.post('/api/v1/sync/checkout').send({ deviceId: device.id, imirIds: [imirId] })).body.data;
    expect(res.refused[0].reason).toMatch(/registered for another plant/);
  });
});
