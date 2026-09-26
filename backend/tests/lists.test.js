import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { uid } from './helpers.js';
import { approveFormat, getAdmin, inwardLot, ok } from './lots.js';

/** The figures above the Incoming Lots, Deviations and DN lists, and the list filters they share. */
describe('list figures', () => {
  it('counts lots by status for a vendor, ignoring the status filter', async () => {
    const a = await getAdmin();
    const vendorCode = uid('LV');
    const itemCode = uid('LC');
    await approveFormat(itemCode);
    const first = await inwardLot({ itemCode, vendorCode, qty: 40 });
    await inwardLot({ itemCode, vendorCode, qty: 40 });
    const { rows: [v] } = await getPool().query('SELECT id FROM mst.vendor WHERE vendor_code = $1', [vendorCode]);

    const c = ok(await a.get('/api/v1/imirs/counts').query({ vendorId: v.id, status: 'CLOSED_ACCEPTED' }));
    expect(c).toMatchObject({ total: 2, toInspect: 2, inspecting: 0, inReview: 0, closed: 0, thisMonth: 2 });

    const list = await a.get('/api/v1/imirs').query({ vendorId: v.id, status: 'OPEN' });
    expect(list.status).toBe(200);
    expect(list.body.data.map((r) => r.id)).toContain(first.imirId);
    expect(list.body.data[0]).toHaveProperty('deviationId', null);
    expect(list.body.data[0]).toHaveProperty('dnId', null);
  });

  it('gives deviation and DN figures, and filters deviations by stage group', async () => {
    const a = await getAdmin();
    const d = ok(await a.get('/api/v1/deviations/counts'));
    expect(Object.keys(d)).toEqual(expect.arrayContaining(['total', 'withDepartment', 'finalDecision', 'escalated', 'quantities', 'closed']));
    const n = ok(await a.get('/api/v1/dns/counts'));
    expect(Object.keys(n)).toEqual(expect.arrayContaining(['total', 'capaAwaited', 'overdue', 'withHead', 'closed']));

    const grouped = await a.get('/api/v1/deviations').query({ stageGroup: 'DEPARTMENT' });
    expect(grouped.status).toBe(200);
    for (const r of grouped.body.data) expect(['INITIATOR', 'SUB_HEAD', 'HEAD']).toContain(r.stage);
    expect((await a.get('/api/v1/deviations').query({ stageGroup: 'NOPE' })).status).toBe(422);
  });
});
