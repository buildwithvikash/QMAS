import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { adminAgent, agentWithRoles, plantId, uid } from './helpers.js';

describe('sampling table', () => {
  it('is seeded from the Sampling Inspection Procedure as the default plan', async () => {
    const { agent } = await adminAgent();
    const plans = (await agent.get('/api/v1/masters/sampling-plans')).body.data;
    const std = plans.find((p) => p.code === 'IQC-STD');
    expect(std.isDefault).toBe(true);
    expect(std.rows).toHaveLength(4);
    expect(std.rows.at(-1)).toEqual({ lotMin: 26, lotMax: null, sampleSize: 8, acceptNo: null, rejectNo: null });
    expect(std.warnings).toEqual([]);
  });

  it('looks up the sample for an inward quantity', async () => {
    const { agent } = await agentWithRoles([{ roleCode: 'IQC_INSPECTOR', plantId: await plantId() }]);
    const hit = await agent.get('/api/v1/masters/sampling-plans/default/lookup').query({ inwardQty: 5000 });
    expect(hit.body.data).toMatchObject({ planCode: 'IQC-STD', lotSize: 5000, sampleSize: 8, acceptNo: 0, rejectNo: 1, basis: 'TABLE' });
    const one = await agent.get('/api/v1/masters/sampling-plans/default/lookup').query({ inwardQty: 1 });
    expect(one.body.data).toMatchObject({ sampleSize: 1, basis: 'FULL_LOT' });
    const small = await agent.get('/api/v1/masters/sampling-plans/default/lookup').query({ inwardQty: 20 });
    expect(small.body.data).toMatchObject({ sampleSize: 5 });
  });

  it('rejects overlapping rows before saving and the database enforces it too', async () => {
    const { agent } = await adminAgent();
    const res = await agent.post('/api/v1/masters/sampling-plans').send({
      code: uid('SP'), name: 'Bad', rows: [{ lotMin: 1, lotMax: 10, sampleSize: 2 }, { lotMin: 5, lotMax: 20, sampleSize: 3 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toEqual({ path: 'rows', message: 'Row 1 (1–10) overlaps the next row starting at 5.' });

    const { rows } = await getPool().query("SELECT id FROM mst.sampling_plan WHERE code = 'IQC-STD'");
    await expect(getPool().query('INSERT INTO mst.sampling_plan_row (plan_id, lot_min, lot_max, sample_size) VALUES ($1, 100, 120, 5)', [rows[0].id]))
      .rejects.toMatchObject({ code: '23P01' });
  });

  it('adds acceptance numbers and a new default plan; only one default at a time', async () => {
    const { agent } = await adminAgent();
    const created = await agent.post('/api/v1/masters/sampling-plans').send({
      code: uid('SP'), name: 'Trial with Ac/Re', isDefault: false,
      rows: [{ lotMin: 1, lotMax: 500, sampleSize: 20, acceptNo: 1, rejectNo: 2 }, { lotMin: 501, lotMax: null, sampleSize: 50, acceptNo: 2, rejectNo: 3 }],
    });
    expect(created.status).toBe(201);
    const plan = created.body.data;
    expect(plan.warnings).toEqual([]);

    const lookup = await agent.get(`/api/v1/masters/sampling-plans/${plan.id}/lookup`).query({ inwardQty: 900000 });
    expect(lookup.body.data).toMatchObject({ sampleSize: 50, acceptNo: 2, rejectNo: 3 });

    const made = await agent.put(`/api/v1/masters/sampling-plans/${plan.id}`).send({ isDefault: true, rowVersion: plan.rowVersion });
    expect(made.body.data.isDefault).toBe(true);
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM mst.sampling_plan WHERE is_default');
    expect(rows[0].n).toBe(1);
    const clear = await agent.put(`/api/v1/masters/sampling-plans/${plan.id}`).send({ isDefault: false, rowVersion: made.body.data.rowVersion });
    expect(clear.status).toBe(422);

    // Restore the procedure table as default for other tests.
    const std = (await agent.get('/api/v1/masters/sampling-plans')).body.data.find((p) => p.code === 'IQC-STD');
    await agent.put(`/api/v1/masters/sampling-plans/${std.id}`).send({ isDefault: true, rowVersion: std.rowVersion });
  });

  it('refuses a lot that a capped table does not cover', async () => {
    const { agent } = await adminAgent();
    const plan = (await agent.post('/api/v1/masters/sampling-plans').send({ code: uid('SP'), name: 'Capped', rows: [{ lotMin: 2, lotMax: 100, sampleSize: 5 }] })).body.data;
    expect(plan.warnings).toEqual(['Lots above 100 are not covered; IMIRs for them cannot be opened until a row is added.']);
    const over = await agent.get(`/api/v1/masters/sampling-plans/${plan.id}/lookup`).query({ inwardQty: 101 });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('LOT_NOT_COVERED');
  });

  it('only sampling.manage may change the table', async () => {
    const { agent } = await agentWithRoles([{ roleCode: 'IQC_INCHARGE', plantId: await plantId() }]);
    const res = await agent.post('/api/v1/masters/sampling-plans').send({ code: uid('SP'), name: 'x', rows: [{ lotMin: 1, lotMax: null, sampleSize: 1 }] });
    expect(res.status).toBe(403);
  });
});
