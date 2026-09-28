import { describe, expect, it } from 'vitest';
import { agentWithRoles, plantId, uid } from './helpers.js';
import { getAdmin, inwardLot } from './lots.js';

/** SAP Sync monitor: pulls listed with filters and duration, figures, one pull's lots, CSV. */
describe('SAP sync monitor', () => {
  it('lists pulls, finds one by the lot it brought in, and shows its lots', async () => {
    const a = await getAdmin();
    const { sapLotNo, sync } = await inwardLot({ itemCode: uid('MON'), qty: 10 });

    const found = await a.get('/api/v1/integration/sap/runs').query({ q: sapLotNo });
    expect(found.status).toBe(200);
    expect(found.body.data.map((r) => r.id)).toEqual([sync.runId]);
    expect(found.body.data[0]).toMatchObject({ status: 'OK', fetched: expect.any(Number), durationSec: expect.any(Number) });
    expect(found.body.meta.total).toBe(1);

    const mine = await a.get('/api/v1/integration/sap/runs').query({ status: 'OK', pageSize: 5 });
    expect(mine.body.data.every((r) => r.status === 'OK')).toBe(true);
    expect((await a.get('/api/v1/integration/sap/runs').query({ by: 'scheduler', q: sapLotNo })).body.data).toEqual([]);

    const detail = (await a.get(`/api/v1/integration/sap/runs/${sync.runId}`)).body.data;
    expect(detail.lots.map((l) => l.sapLotNo)).toContain(sapLotNo);
    expect(detail.lots.find((l) => l.sapLotNo === sapLotNo)).toMatchObject({ plantSapCode: '1115', imirId: expect.any(String) });

    const s = (await a.get('/api/v1/integration/sap/summary')).body.data;
    expect(s).toMatchObject({ mode: 'mock', state: 'CONNECTED', intervalMin: expect.any(Number) });
    expect(s.last.id).toBeGreaterThanOrEqual(sync.runId);
    expect(s.last24h.pulls).toBeGreaterThan(0);

    const csv = await a.get('/api/v1/integration/sap/runs').query({ q: sapLotNo, format: 'csv' });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Started,Finished,Status');
  });

  it('is only for integration monitors', async () => {
    const { agent } = await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId('1115') }]);
    expect((await agent.get('/api/v1/integration/sap/summary')).status).toBe(403);
  });
});
