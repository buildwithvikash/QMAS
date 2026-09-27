import ExcelJS from 'exceljs';
import { yesNoOptions } from '@qmas/shared';
import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { agentWithRoles, plantId, uid } from './helpers.js';
import { inspector, inwardLot, ok } from './lots.js';

/** Format builder: a custom format with its own sections and field types, inspected end to end, and format history. */

const SHADE = [{ label: 'Matches master', pass: true }, { label: 'Slight variation', pass: true }, { label: 'Mismatch', pass: false }];
const CUSTOM = [
  { section: 'RECORD', groupLabel: 'Supplier documents', inputType: 'TEXT', checkpoint: 'Batch no.', helpText: 'From the supplier label' },
  { section: 'RECORD', groupLabel: 'Supplier documents', inputType: 'YES_NO', checkpoint: 'Test certificate received', options: yesNoOptions('YES') },
  { section: 'RECORD', groupLabel: 'Supplier documents', inputType: 'NUMBER', checkpoint: 'Net weight', uom: 'kg', lsl: 1.9, usl: 2.1 },
  { section: 'RECORD', groupLabel: 'Supplier documents', inputType: 'DATE', checkpoint: 'Date of manufacture', isRequired: false },
  { section: 'DIMENSIONAL', groupLabel: 'Critical dimensions', checkpoint: 'Dia', specification: '10 ± 0.1', lsl: 9.9, usl: 10.1, uom: 'mm' },
  { section: 'VISUAL', groupLabel: 'Finish', inputType: 'CHOICE', checkpoint: 'Colour shade', specification: 'Against master sample', options: SHADE },
];

async function newItem() {
  const { rows } = await getPool().query("INSERT INTO mst.item (item_code, description) VALUES ($1, 'Painted panel') RETURNING id, item_code", [uid('CUS')]);
  return rows[0];
}

describe('format builder', () => {
  it('builds a custom format, keeps its history, and inspects a lot against it', async () => {
    const item = await newItem();
    const { agent: hd } = await agentWithRoles([{ roleCode: 'IQC_HEAD', plantId: await plantId('1115') }]);

    // Build: custom draft, first save, then a change.
    const d = ok(await hd.post(`/api/v1/formats/items/${item.id}/drafts`).send({ from: 'CUSTOM' }));
    expect(d).toMatchObject({ source: 'CUSTOM', checkpoints: [] });
    const s1 = ok(await hd.put(`/api/v1/formats/versions/${d.id}`).send({ checkpoints: CUSTOM, rowVersion: d.rowVersion, formatNo: 'F-CUS' }));
    expect(s1.checkpoints.find((c) => c.checkpoint === 'Colour shade')).toMatchObject({ inputType: 'CHOICE', groupLabel: 'Finish', options: SHADE });
    expect(s1.checkpoints.find((c) => c.checkpoint === 'Date of manufacture').isRequired).toBe(false);
    const changed = s1.checkpoints.map((c) => (c.checkpoint === 'Net weight' ? { ...c, usl: 2.2 } : c));
    const s2 = ok(await hd.put(`/api/v1/formats/versions/${d.id}`).send({ checkpoints: changed, rowVersion: s1.rowVersion, formatNo: 'F-CUS' }));
    // A save without changes adds nothing to the history.
    const s3 = ok(await hd.put(`/api/v1/formats/versions/${d.id}`).send({ checkpoints: s2.checkpoints, rowVersion: s2.rowVersion, formatNo: 'F-CUS' }));

    // Bad builder input is refused with field errors.
    const bad = await hd.put(`/api/v1/formats/versions/${d.id}`).send({ checkpoints: [{ section: 'VISUAL', inputType: 'CHOICE', checkpoint: 'Shade', specification: 'x', options: [{ label: 'A', pass: true }] }], rowVersion: s3.rowVersion });
    expect(bad.status).toBe(422);

    const p = ok(await hd.post(`/api/v1/formats/versions/${d.id}/actions`).send({ action: 'submit', rowVersion: s3.rowVersion })).version;
    const a = ok(await hd.post(`/api/v1/formats/versions/${p.id}/actions`).send({ action: 'approve', rowVersion: p.rowVersion }));
    expect(a.outcome).toMatchObject({ result: 'APPROVED', versionNo: 1 });

    // History: created → saved (6 added) → saved (net weight USL) → submitted → approved, newest first.
    const hist = ok(await hd.get(`/api/v1/formats/items/${item.id}/history`));
    expect(hist.map((e) => e.action)).toEqual(['APPROVED', 'SUBMITTED', 'SAVED', 'SAVED', 'CREATED']);
    expect(hist[4].detail).toMatchObject({ source: 'CUSTOM' });
    expect(hist[3].detail.added).toHaveLength(6);
    expect(hist[2].detail.changed).toEqual([expect.objectContaining({ checkpoint: 'Net weight', fields: [{ field: 'usl', from: 2.1, to: 2.2 }] })]);
    expect(hist[0].detail).toMatchObject({ versionNo: 1 });
    expect(hist[0].detail.changes.added).toHaveLength(6);
    expect(ok(await hd.get(`/api/v1/formats/versions/${d.id}/history`))).toHaveLength(5);
    expect(ok(await hd.get('/api/v1/formats/counts'))).toMatchObject({ items: expect.any(Number), approved: expect.any(Number) });

    // Inspect a lot of this item.
    const { imirId } = await inwardLot({ itemCode: item.item_code, qty: 2 });
    const { agent } = await inspector();
    const m = ok(await agent.get(`/api/v1/imirs/${imirId}`));
    const cp = (name) => m.checkpoints.find((c) => c.checkpoint === name);
    expect(cp('Date of manufacture').isRequired).toBe(false);
    expect(cp('Colour shade')).toMatchObject({ inputType: 'CHOICE', groupLabel: 'Finish' });
    const put = (body) => agent.put(`/api/v1/imirs/${imirId}/inspection`).send(body);

    // Answers are checked against the field type.
    expect((await put({ entries: [{ checkpointUid: cp('Net weight').uid, textObservation: 'heavy' }] })).body.message).toBe('Net weight: enter a number (up to 3 decimals).');
    expect((await put({ entries: [{ checkpointUid: cp('Test certificate received').uid, textObservation: 'Maybe' }] })).body.message).toBe('Test certificate received: choose one of Yes, No.');
    expect((await put({ cells: [{ checkpointUid: cp('Colour shade').uid, sampleNo: 1, value: 5 }] })).body.message).toBe('Choose one of the options of Colour shade.');
    expect((await put({ cells: [{ checkpointUid: cp('Batch no.').uid, sampleNo: 1, value: 1 }] })).body.message).toBe('Batch no. is recorded once per lot, not per sample.');

    const n = m.sampleSize;
    const cells = [
      ...Array.from({ length: n }, (_, i) => ({ checkpointUid: cp('Dia').uid, sampleNo: i + 1, value: 10 })),
      ...Array.from({ length: n }, (_, i) => ({ checkpointUid: cp('Colour shade').uid, sampleNo: i + 1, value: i === 0 ? 1 : 0 })),
    ];
    const entries = [
      { checkpointUid: cp('Batch no.').uid, textObservation: 'B-17' },
      { checkpointUid: cp('Test certificate received').uid, textObservation: 'Yes' },
      { checkpointUid: cp('Net weight').uid, textObservation: '2.05' },
    ];
    const saved = ok(await put({ model: 'FR-1', cells, entries }));
    expect(saved.evaluation.missing).toEqual([]);
    expect(saved.evaluation.result).toBe('OK');
    // A failing answer makes the lot Not OK.
    const failing = ok(await put({ entries: [{ checkpointUid: cp('Test certificate received').uid, textObservation: 'No' }] }));
    expect(failing.evaluation.result).toBe('NOK');
    expect(failing.evaluation.checkpointResults[cp('Test certificate received').uid]).toBe('NOK');
    const back = ok(await put({ entries: [{ checkpointUid: cp('Test certificate received').uid, textObservation: 'Yes' }] }));
    const sub = ok(await agent.post(`/api/v1/imirs/${imirId}/actions`).send({ action: 'submit', rowVersion: back.rowVersion }));
    expect(sub.result).toBe('OK');

    // The report shows the custom sections, the chosen option and the lot details.
    const x = await agent.get(`/api/v1/imirs/${imirId}/xlsx`).buffer(true).parse((res, cb) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const text = [];
    wb.worksheets[0].eachRow((r) => r.eachCell((c) => { if (c.isMerged && c.master !== c) return; if (c.text) text.push(c.text); }));
    expect(text).toEqual(expect.arrayContaining(['Supplier documents :', 'Critical dimensions :', 'Finish :', 'Slight variation', 'B-17', '2.05 kg']));
  });
});
