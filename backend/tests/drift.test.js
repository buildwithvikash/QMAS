import { describe, expect, it } from 'vitest';
import { uid } from './helpers.js';
import { approveFormat, cellsFor, getAdmin, inspector, inwardLot, ok } from './lots.js';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** Receives and inspects a lot of the item with the given Dia readings (spec 10 ± 0.1). */
async function inspectLot(agent, itemCode, vendorCode, reading) {
  const { imirId } = await inwardLot({ itemCode, vendorCode, qty: 40 });
  let m = ok(await agent.get(`/api/v1/imirs/${imirId}`));
  const dims = Array.from({ length: m.sampleSize }, () => reading);
  const vis = Array.from({ length: m.sampleSize }, () => true);
  m = ok(await agent.put(`/api/v1/imirs/${imirId}/inspection`).send({ model: 'FR-1', cells: [...cellsFor(m, 'DIMENSIONAL', dims), ...cellsFor(m, 'VISUAL', vis)] }));
  return ok(await agent.post(`/api/v1/imirs/${imirId}/actions`).send({ action: 'submit', rowVersion: m.rowVersion }));
}

describe('measurement drift report', () => {
  it('lists a check point whose latest lot is close to a limit, with the usual values', async () => {
    const { agent } = await inspector();
    const itemCode = uid('DR');
    const vendorCode = uid('V');
    await approveFormat(itemCode);
    for (const r of [10, 10.01, 9.99, 10]) await inspectLot(agent, itemCode, vendorCode, r);
    const latest = await inspectLot(agent, itemCode, vendorCode, 10.09);

    const report = ok(await (await getAdmin()).get('/api/v1/reports/measurement-drift').query({ from: today, to: today }));
    expect(report).toMatchObject({ name: 'Measurement drift', dated: 'Inspected' });
    const row = report.rows.find((r) => r.itemCode === itemCode);
    expect(row).toMatchObject({
      finding: 'Close to limit', checkpoint: 'Dia', lsl: 9.9, usl: 10.1, lotMean: 10.09, usualMean: 10, earlierLots: 4, direction: 'Up',
      imirId: latest.id, imirNo: latest.imirNo,
    });
    expect(row.detail).toMatch(/90 % of the tolerance/);

    // A steady item is not listed.
    const steady = uid('DR');
    await approveFormat(steady);
    for (const r of [10, 10.01]) await inspectLot(agent, steady, vendorCode, r);
    const again = ok(await (await getAdmin()).get('/api/v1/reports/measurement-drift').query({ from: today, to: today }));
    expect(again.rows.some((r) => r.itemCode === steady)).toBe(false);
  });
});
