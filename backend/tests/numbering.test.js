import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { withTransaction } from '../src/db/tx.js';
import { issueNumber } from '../src/modules/numbering/numbering.service.js';
import { adminAgent, plantId } from './helpers.js';

const IST_JULY_1 = new Date('2026-07-01T05:00:00+05:30');
const issue = (opts) => withTransaction({}, (db) => issueNumber(db, opts));

describe('document numbering', () => {
  it('issues blueprint option 1 numbers, resetting per plant and day', async () => {
    const sanjan = await plantId('1115');
    const silvassa = await plantId('1111');
    expect((await issue({ docType: 'IMIR', plantId: sanjan, at: IST_JULY_1 })).docNo).toBe('IMIR1115260701001');
    expect((await issue({ docType: 'IMIR', plantId: sanjan, at: IST_JULY_1 })).docNo).toBe('IMIR1115260701002');
    expect((await issue({ docType: 'IMIR', plantId: silvassa, at: IST_JULY_1 })).docNo).toBe('IMIR1111260701001');
    expect((await issue({ docType: 'IMIR', plantId: sanjan, at: new Date('2026-07-02T09:00:00+05:30') })).docNo).toBe('IMIR1115260702001');
  });

  it('issues DN numbers with the source code, resetting monthly', async () => {
    const tadgam = await plantId('1125');
    expect((await issue({ docType: 'DN', plantId: tadgam, src: 'IL', at: IST_JULY_1 })).docNo).toBe('DN1125IL2607001');
    expect((await issue({ docType: 'DN', plantId: tadgam, src: 'IL', at: new Date('2026-07-28T10:00:00+05:30') })).docNo).toBe('DN1125IL2607002');
  });

  it('never issues the same number twice under concurrency', async () => {
    const plant = await plantId('1191');
    const at = new Date('2026-08-15T10:00:00+05:30');
    const results = await Promise.all(Array.from({ length: 25 }, () => issue({ docType: 'IMIR', plantId: plant, at })));
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.docNo)).size).toBe(25);
  });

  it('gives the number back when the document transaction rolls back', async () => {
    const plant = await plantId('1130');
    const at = new Date('2026-09-01T10:00:00+05:30');
    await expect(withTransaction({}, async (db) => {
      await issueNumber(db, { docType: 'IMIR', plantId: plant, at });
      throw new Error('document insert failed');
    })).rejects.toThrow('document insert failed');
    expect((await issue({ docType: 'IMIR', plantId: plant, at })).seq).toBe(1);
  });

  it('lets an admin switch a plant to option 2 without ever repeating a number', async () => {
    const { agent } = await adminAgent();
    const plant = await plantId('1120');
    const at = new Date('2026-10-05T10:00:00+05:30');
    expect((await issue({ docType: 'IMIR', plantId: plant, at })).docNo).toBe('IMIR1120261005001');

    const created = await agent.post('/api/v1/masters/number-series').send({
      docType: 'IMIR', plantId: plant, pattern: 'imir{plant_short}{yy}{mm}{dd}{seq:3}',
      resetScope: 'DAY', effectiveFrom: '2026-10-05T00:00:00+05:30',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.pattern).toBe('IMIR{PLANT_SHORT}{YY}{MM}{DD}{SEQ:3}');
    // Same counter continues, so the plant-specific series picks up at 002.
    expect((await issue({ docType: 'IMIR', plantId: plant, at })).docNo).toBe('IMIR05261005002');

    const preview = await agent.post('/api/v1/masters/number-series/preview').send({ docType: 'IMIR', plantId: plant, date: '2026-10-05T12:00:00+05:30' });
    expect(preview.body.data).toMatchObject({ docNo: 'IMIR05261005003', seq: 3 });
    const draft = await agent.post('/api/v1/masters/number-series/preview').send({
      docType: 'IMIR', plantId: plant, pattern: 'IQ-{PLANT_SAP}/{YYYY}/{SEQ:5}', resetScope: 'YEAR', date: '2026-10-05T12:00:00+05:30',
    });
    expect(draft.body.data.docNo).toBe('IQ-1120/2026/00001');

    // Deactivate the plant series again: the default (option 1) applies.
    await agent.patch(`/api/v1/masters/number-series/${created.body.data.id}`).send({ isActive: false, rowVersion: created.body.data.rowVersion });
    expect((await issue({ docType: 'IMIR', plantId: plant, at })).docNo).toBe('IMIR1120261005003');
  });

  it('rejects unusable patterns with the reason', async () => {
    const { agent } = await adminAgent();
    const res = await agent.post('/api/v1/masters/number-series').send({ docType: 'IMIR', pattern: 'IMIR{PLANT_SAP}{YY}{MM}{SEQ:3}', resetScope: 'DAY' });
    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([{ path: 'pattern', message: 'A daily reset needs {YY} or {YYYY}, {MM} and {DD} in the pattern.' }]);
  });

  it('explains when no series is active', async () => {
    const plant = await plantId('1179');
    await getPool().query("UPDATE core.number_series SET is_active = false WHERE doc_type = 'DEVIATION'");
    await expect(issue({ docType: 'DEVIATION', plantId: plant })).rejects.toMatchObject({ statusCode: 409, code: 'NO_NUMBER_SERIES' });
    await getPool().query("UPDATE core.number_series SET is_active = true WHERE doc_type = 'DEVIATION'");
  });
});
