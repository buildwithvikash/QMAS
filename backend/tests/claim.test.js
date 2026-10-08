import { beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { uid } from './helpers.js';
import { approveFormat, cellsFor, inspector, inwardLot, ok } from './lots.js';

// One inspector at a time per lot: the first to save holds it; others may look, take it over
// (recorded, the first is told) or continue once the hold has lapsed.
let A;
let B;
beforeAll(async () => {
  A = await inspector('1115');
  B = await inspector('1115');
});

async function openLot() {
  const itemCode = uid('CLM');
  await approveFormat(itemCode);
  const { imirId } = await inwardLot({ itemCode, qty: 40 });
  return imirId;
}
const get = async (who, id) => ok(await who.agent.get(`/api/v1/imirs/${id}`));
const save = (who, id, body) => who.agent.put(`/api/v1/imirs/${id}/inspection`).send(body);
const names = async (who) => (await (await who.agent.get('/api/v1/auth/me')).body.data.user).fullName;

describe('one inspector at a time', () => {
  it('the first to save holds the lot; another inspector can only look or take it over', async () => {
    const id = await openLot();
    const m = await get(A, id);
    ok(await save(A, id, { cells: cellsFor(m, 'DIMENSIONAL', [10]) }));

    const seenByB = await get(B, id);
    expect(seenByB.claim).toMatchObject({ name: await names(A), active: true, mine: false });
    expect(seenByB.allowedActions).toEqual(['take_over']);
    const refused = await save(B, id, { cells: cellsFor(m, 'DIMENSIONAL', [10.05]) });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('CLAIMED');
    expect((await B.agent.post(`/api/v1/imirs/${id}/actions`).send({ action: 'submit', rowVersion: seenByB.rowVersion })).body.code).toBe('CLAIMED');

    // My Tasks: the lot is A's work, not B's.
    expect(ok(await A.agent.get('/api/v1/tasks/me')).some((t) => t.id === id)).toBe(true);
    expect(ok(await B.agent.get('/api/v1/tasks/me')).some((t) => t.id === id)).toBe(false);
  });

  it('take over moves the lot, is in the history, tells the first inspector and makes the second the report\'s inspector', async () => {
    const id = await openLot();
    const m = await get(A, id);
    ok(await save(A, id, { cells: cellsFor(m, 'DIMENSIONAL', [10]) }));

    const taken = ok(await B.agent.post(`/api/v1/imirs/${id}/take-over`));
    expect(taken.allowedActions).toContain('inspect');
    expect(taken.claim).toMatchObject({ mine: true });
    expect(taken.inspectedByName).toBe(await names(B));
    expect(taken.history.at(-1)).toMatchObject({ action: 'TAKE_OVER', payload: { lapsed: false } });
    expect(taken.cells.some((c) => c.value === 10)).toBe(true); // A's reading stays

    expect((await save(A, id, { cells: cellsFor(m, 'DIMENSIONAL', [10, 10]) })).body.code).toBe('CLAIMED');
    const bell = ok(await A.agent.get('/api/v1/notifications'));
    expect(bell.some((n) => n.kind === 'TAKEN_OVER' && n.link === `/imirs/${id}`)).toBe(true);
  });

  it('a hold lapses after INSPECTION_CLAIM_MINUTES without a save; continuing is recorded', async () => {
    const id = await openLot();
    const m = await get(A, id);
    ok(await save(A, id, { cells: cellsFor(m, 'DIMENSIONAL', [10]) }));
    await getPool().query("UPDATE qms.imir SET claimed_at = now() - interval '2 hours' WHERE id = $1", [id]);

    expect((await get(B, id)).claim).toMatchObject({ active: false });
    const cont = ok(await save(B, id, { cells: cellsFor(m, 'DIMENSIONAL', [10, 10]) }));
    expect(cont.claim).toMatchObject({ mine: true, active: true });
    expect(cont.history.at(-1)).toMatchObject({ action: 'TAKE_OVER', payload: { lapsed: true } });
  });

  it('submitting releases the lot', async () => {
    const id = await openLot();
    let m = await get(A, id);
    const dims = Array.from({ length: m.sampleSize }, () => 10);
    const vis = Array.from({ length: m.sampleSize }, () => true);
    m = ok(await save(A, id, { cells: [...cellsFor(m, 'DIMENSIONAL', dims), ...cellsFor(m, 'VISUAL', vis)] }));
    const sub = ok(await A.agent.post(`/api/v1/imirs/${id}/actions`).send({ action: 'submit', rowVersion: m.rowVersion }));
    expect(sub.status).toBe('SUBMITTED');
    expect(sub.claim).toBeNull();
  });
});
