import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine runs in a browser; give it the few globals it uses.
globalThis.window = { addEventListener() {}, removeEventListener() {} };
const net = { online: true };
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return net.online; }, storage: { persist: async () => true } }, configurable: true });

const DEVICE = { id: '11111111-1111-4111-8111-111111111111', deviceCode: 'TAB-1', name: 'Stores', plantId: 2, plantName: 'Sanjan', plantSapCode: '1115' };
const IMIR = '22222222-2222-4222-8222-222222222222';
const DIM = { uid: '33333333-3333-4333-8333-333333333333', section: 'DIMENSIONAL', checkpoint: 'Dia', lsl: 9.9, usl: 10.1, isRequired: true };
const bundle = () => ({ id: IMIR, imirNo: 'IMIR1115260923001', sampleSize: 2, acceptNo: 0, rejectNo: 1, model: null, cells: [], checkpoints: [{ ...DIM }], rowVersion: 3 });

/** Scripted server: records what it receives and answers like the real API. */
let server;
function installServer() {
  server = { pushed: [], uploads: 0, failPush: false, refuse: new Set(), submitted: false };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = url.replace('/api/v1', '');
    const json = (status, data) => ({ ok: status < 400, status, json: async () => (status < 400 ? { success: true, data } : { success: false, ...data }) });
    if (!net.online) throw new TypeError('Failed to fetch');
    if (path.startsWith('/devices/by-code/')) return json(200, DEVICE);
    if (path === '/sync/checkout') return json(200, { checkedOut: [bundle()], refused: [] });
    if (path === '/sync/release') return json(200, { released: [IMIR] });
    if (path.endsWith('/attachments')) { server.uploads += 1; return json(201, { id: 'f1' }); }
    if (path === '/sync/push') {
      if (server.failPush) throw new TypeError('Failed to fetch');
      const { ops } = JSON.parse(init.body);
      const results = ops.map((op) => {
        server.pushed.push(op);
        if (server.refuse.has(op.type)) return { opId: op.opId, outcome: 'CONFLICT', message: 'This IMIR has been submitted; observations can no longer change.' };
        if (op.type === 'SUBMIT') server.submitted = true;
        return { opId: op.opId, outcome: 'ACCEPTED' };
      });
      return json(200, { results, imirs: [{ id: IMIR, status: server.submitted ? 'SUBMITTED' : 'IN_INSPECTION', rowVersion: 4, checkedOut: !server.submitted }] });
    }
    return json(404, { message: `unexpected ${path}` });
  });
}

let engine;
let store;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.resetModules();
  globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory(); // fresh database per test
  net.online = true;
  installServer();
  engine = await import('./engine.js');
  store = await import('./store.js');
  await engine.registerThisTablet('tab-1');
  await engine.checkout([IMIR]);
});
afterEach(() => vi.useRealTimers());

const cell = (sampleNo, value) => ({ checkpointUid: DIM.uid, sampleNo, value });

describe('offline inspection engine', () => {
  it('records entries while offline, evaluates them locally, and sends them in order when back online', async () => {
    net.online = false;
    let b = await engine.recordSave(IMIR, { cells: [cell(1, 10)] });
    b = await engine.recordSave(IMIR, { cells: [cell(2, 10.3)], model: 'FR-250' });
    expect(b.evaluation).toMatchObject({ result: 'NOK', defectiveSamples: [2], missing: [] });

    expect(await engine.syncNow()).toMatchObject({ offline: true });
    expect((await engine.status()).pendingOps).toBe(2);

    net.online = true;
    const r = await engine.syncNow();
    expect(r).toEqual({ sent: 2, refused: 0 });
    expect(server.pushed.map((o) => o.payload)).toEqual([{ cells: [cell(1, 10)] }, { cells: [cell(2, 10.3)], model: 'FR-250' }]);
    expect(server.pushed.every((o) => o.opId && o.clientTime && o.imirId === IMIR)).toBe(true);
    const s = await engine.status();
    expect(s.pendingOps).toBe(0);
    expect(s.bundles[0]).toMatchObject({ rowVersion: 4, localChanges: false });
  });

  it('keeps queued entries when the connection drops during a sync', async () => {
    await engine.recordSave(IMIR, { cells: [cell(1, 10)] });
    server.failPush = true;
    await expect(engine.syncNow()).rejects.toThrow('Failed to fetch');
    expect((await engine.status()).pendingOps).toBe(1);
    server.failPush = false;
    expect(await engine.syncNow()).toEqual({ sent: 1, refused: 0 });
  });

  it('submits offline once complete, then drops the lot from the tablet after the server accepts it', async () => {
    net.online = false;
    await expect(engine.recordSubmit(IMIR)).rejects.toThrow('2 required observation(s) are still empty.');
    await engine.recordSave(IMIR, { cells: [cell(1, 10), cell(2, 10)] });
    await expect(engine.recordSubmit(IMIR)).rejects.toThrow('Enter the model before submitting.');
    await engine.recordSave(IMIR, { model: 'M1' });
    await engine.recordSubmit(IMIR);
    expect((await store.getBundle(IMIR)).pendingSubmit).toBe(true);
    await expect(engine.recordSave(IMIR, { model: 'M2' })).rejects.toThrow('waiting to be submitted');

    net.online = true;
    await engine.syncNow();
    expect(server.pushed.at(-1).type).toBe('SUBMIT');
    expect((await engine.status()).bundles).toEqual([]);
  });

  it('shows refused operations under "needs attention" instead of losing them', async () => {
    server.refuse.add('SAVE');
    await engine.recordSave(IMIR, { cells: [cell(1, 10)] });
    const r = await engine.syncNow();
    expect(r).toEqual({ sent: 0, refused: 1 });
    const b = await store.getBundle(IMIR);
    expect(b.attention).toMatch(/observations can no longer change/);
    expect(b.cells).toEqual([{ checkpointUid: DIM.uid, sampleNo: 1, value: 10, ok: null }]);
  });

  it('uploads photos taken offline before pushing entries, and refuses to release a lot with unsent entries', async () => {
    net.online = false;
    await engine.recordPhoto(IMIR, { checkpointUid: DIM.uid, sampleNo: 1, file: new Blob(['x'], { type: 'image/png' }) });
    await engine.recordSave(IMIR, { cells: [cell(1, 10)] });
    await expect(engine.release(IMIR)).rejects.toThrow('not been sent yet');
    net.online = true;
    expect(await engine.syncNow()).toEqual({ sent: 2, refused: 0 });
    expect(server.uploads).toBe(1);
    await engine.release(IMIR);
    expect((await engine.status()).bundles).toEqual([]);
  });

  it('does not overwrite unsent local entries when a lot is checked out again', async () => {
    net.online = false;
    await engine.recordSave(IMIR, { cells: [cell(1, 9.95)] });
    net.online = true;
    server.failPush = true; // keep it unsent
    await engine.checkout([IMIR]);
    expect((await store.getBundle(IMIR)).cells).toHaveLength(1);
  });
});
