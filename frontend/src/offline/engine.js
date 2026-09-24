import { applyPatch, evaluateSheet } from './sheetModel.js';
import * as store from './store.js';

/**
 * Offline inspection engine. Every change is applied to the local copy first (so the screen works
 * without a network), queued as an operation with its own UUID, and pushed in order when online.
 * The server applies each operation once, recomputes all decisions, and answers per operation;
 * refused operations are kept visible under "Needs attention", never silently dropped.
 */
const listeners = new Set();
let syncing = null;
let currentUserId = null;

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => fn());

/**
 * The signed-in user. Entries are stamped with who recorded them, and only that user's entries are
 * sent: when inspectors share a tablet, each one's offline work is credited to them.
 */
export function setCurrentUser(id) {
  if (currentUserId === id) return;
  currentUserId = id;
  notify();
  if (id) scheduleSync(500);
}
const mine = (x) => !x.recordedBy || x.recordedBy === currentUserId;

async function api(path, { method = 'GET', body, form } = {}) {
  const send = () =>
    fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: form ? { 'X-Client': 'tablet' } : { 'Content-Type': 'application/json', 'X-Client': 'tablet' },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
  let res = await send();
  if (res.status === 401) {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-Client': 'tablet' } });
    if (r.ok) res = await send();
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message ?? `Request failed (${res.status})`);
    Object.assign(err, { status: res.status, code: data?.code });
    throw err;
  }
  return data?.data;
}

// ── Device ────────────────────────────────────────────────────────────────────

export const getDevice = () => store.getMeta('device');

export async function registerThisTablet(deviceCode) {
  const device = await api(`/devices/by-code/${encodeURIComponent(deviceCode.trim())}`);
  await store.setMeta('device', { id: device.id, code: device.deviceCode, name: device.name, plantId: device.plantId, plantName: device.plantName, plantSapCode: device.plantSapCode });
  await store.requestPersistence();
  startAutoSync();
  notify();
  return device;
}

export async function forgetThisTablet() {
  const ops = await store.listOps();
  const files = await store.listFiles();
  if (ops.length || files.length) throw new Error('This tablet still has entries that have not been sent. Sync first.');
  for (const b of await store.listBundles()) await store.deleteBundle(b.id);
  await store.deleteMeta('device');
  notify();
}

// ── Checkout / release ────────────────────────────────────────────────────────

export async function checkout(imirIds) {
  const device = await getDevice();
  if (!device) throw new Error('Set up this tablet first.');
  const res = await api('/sync/checkout', { method: 'POST', body: { deviceId: device.id, imirIds } });
  for (const b of res.checkedOut) {
    const existing = await store.getBundle(b.id);
    // Never overwrite entries not yet sent.
    if (!existing?.localChanges) await store.putBundle({ ...b, checkedOutAt: new Date().toISOString(), attention: null });
  }
  notify();
  return res;
}

export async function release(imirId) {
  const device = await getDevice();
  const pending = (await store.listOps()).some((o) => o.imirId === imirId) || (await store.listFiles()).some((f) => f.imirId === imirId);
  if (pending) throw new Error('This lot has entries that have not been sent yet. Sync first.');
  if (navigator.onLine) await api('/sync/release', { method: 'POST', body: { deviceId: device.id, imirIds: [imirId] } });
  await store.deleteBundle(imirId);
  notify();
}

// ── Recording ─────────────────────────────────────────────────────────────────

/** Saves entries locally and queues them. Returns the updated bundle. */
export async function recordSave(imirId, patch) {
  const b = await store.getBundle(imirId);
  if (!b) throw new Error('This lot is not on this tablet.');
  if (b.pendingSubmit) throw new Error('This lot is waiting to be submitted and can no longer change.');
  const next = { ...applyPatch(b, patch), localChanges: true };
  await store.putBundle(next);
  await store.addOp({ opId: crypto.randomUUID(), type: 'SAVE', imirId, clientTime: new Date().toISOString(), recordedBy: currentUserId, payload: patch });
  notify();
  scheduleSync();
  return next;
}

export async function recordPhoto(imirId, { checkpointUid, sampleNo, file }) {
  await store.addFile({ localId: crypto.randomUUID(), imirId, checkpointUid, sampleNo, blob: file, name: file.name, capturedAt: new Date().toISOString(), recordedBy: currentUserId });
  notify();
  scheduleSync();
}

export async function recordSubmit(imirId) {
  const b = await store.getBundle(imirId);
  const evaluation = evaluateSheet(b);
  if (evaluation.missing.length) throw new Error(`${evaluation.missing.length} required observation(s) are still empty.`);
  if (!b.model) throw new Error('Enter the model before submitting.');
  await store.putBundle({ ...b, pendingSubmit: true });
  await store.addOp({ opId: crypto.randomUUID(), type: 'SUBMIT', imirId, clientTime: new Date().toISOString(), recordedBy: currentUserId, payload: {} });
  notify();
  scheduleSync();
}

// ── Sync ──────────────────────────────────────────────────────────────────────

let timer = null;
function scheduleSync(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

/**
 * Sends photos, then queued operations in order. Safe to call any time; concurrent calls share
 * one run. Returns { sent, refused } counts.
 */
export function syncNow() {
  syncing ??= (async () => {
    const device = await getDevice();
    if (!device || !navigator.onLine) return { sent: 0, refused: 0, offline: !navigator.onLine };
    if (!currentUserId) return { sent: 0, refused: 0, signedOut: true };
    let sent = 0;
    let refused = 0;

    for (const f of (await store.listFiles()).filter(mine)) {
      const form = new FormData();
      form.append('file', f.blob, f.name);
      form.append('checkpointUid', f.checkpointUid);
      form.append('sampleNo', String(f.sampleNo));
      form.append('capturedAt', f.capturedAt);
      form.append('deviceId', device.id);
      try {
        await api(`/imirs/${f.imirId}/attachments`, { method: 'POST', form });
        sent += 1;
      } catch (err) {
        if (!err.status) throw err; // network: try again later
        refused += 1;
        await markAttention(f.imirId, `Photo "${f.name}" was not accepted: ${err.message}`);
      }
      await store.deleteFile(f.localId);
    }

    const ops = (await store.listOps()).filter(mine);
    for (let i = 0; i < ops.length; i += 50) {
      const batch = ops.slice(i, i + 50);
      const res = await api('/sync/push', { method: 'POST', body: { deviceId: device.id, ops: batch.map(({ seq: _seq, ...op }) => op) } });
      const keep = new Set();
      for (const r of res.results) {
        if (r.outcome === 'ACCEPTED') sent += 1;
        else if (r.outcome === 'WRONG_USER') keep.add(r.opId); // stays queued for the inspector who recorded it
        else {
          refused += 1;
          const op = batch.find((o) => o.opId === r.opId);
          await markAttention(op.imirId, r.message ?? 'Not accepted by the server.');
        }
      }
      await store.deleteOps(batch.filter((o) => !keep.has(o.opId)).map((o) => o.seq));
      for (const s of res.imirs) {
        const b = await store.getBundle(s.id);
        if (!b) continue;
        if (s.status === 'SUBMITTED' || !s.checkedOut) await store.deleteBundle(s.id); // done, or released elsewhere
        else await store.putBundle({ ...b, rowVersion: s.rowVersion, localChanges: (await store.listOps()).some((o) => o.imirId === s.id) });
      }
    }
    await store.setMeta('lastSyncAt', new Date().toISOString());
    return { sent, refused };
  })().finally(() => {
    syncing = null;
    notify();
  });
  return syncing;
}

async function markAttention(imirId, message) {
  const b = await store.getBundle(imirId);
  if (b) await store.putBundle({ ...b, attention: message, pendingSubmit: false });
  else {
    const list = (await store.getMeta('attention')) ?? [];
    await store.setMeta('attention', [...list, { imirId, message, at: new Date().toISOString() }]);
  }
}

/** Snapshot for the tablet screen. */
export async function status() {
  const [device, bundles, allOps, allFiles, lastSyncAt, attention, storage] = await Promise.all([
    getDevice(), store.listBundles(), store.listOps(), store.listFiles(), store.getMeta('lastSyncAt'), store.getMeta('attention'), store.storageStatus(),
  ]);
  const ops = allOps.filter(mine);
  const files = allFiles.filter(mine);
  const times = [...allOps.map((o) => o.clientTime), ...allFiles.map((f) => f.capturedAt)].filter(Boolean).sort();
  return {
    device,
    bundles: bundles.sort((a, b) => (a.checkedOutAt < b.checkedOutAt ? 1 : -1)),
    pendingOps: ops.length,
    pendingFiles: files.length,
    pendingOthers: allOps.length - ops.length + allFiles.length - files.length,
    oldestPendingAt: times[0] ?? null,
    storage,
    pendingByImir: Object.fromEntries(bundles.map((b) => [b.id, ops.filter((o) => o.imirId === b.id).length + files.filter((f) => f.imirId === b.id).length])),
    lastSyncAt,
    orphanAttention: attention ?? [],
    online: navigator.onLine,
  };
}

export const clearOrphanAttention = () => store.deleteMeta('attention').then(notify);

/** Entries and photos not yet sent, all users (sign-out warns on these). */
export async function unsentCount() {
  const [ops, files] = await Promise.all([store.listOps(), store.listFiles()]);
  return ops.length + files.length;
}

/** Asks the browser to keep this tablet's data even when the device runs low on space. */
export async function protectStorage() {
  const ok = await store.requestPersistence();
  notify();
  return ok;
}

// ── Backup of unsent work ─────────────────────────────────────────────────────

const BACKUP_FORMAT = 'qmas-tablet-backup';
const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

/**
 * Everything on the tablet that the server has not received (lots, queued entries, photos) as one
 * file, so work survives even if the browser's storage is lost. Returns a Blob to save.
 */
export async function exportBackup() {
  const device = await getDevice();
  if (!device) throw new Error('This tablet is not set up.');
  const [bundles, ops, files] = await Promise.all([store.listBundles(), store.listOps(), store.listFiles()]);
  const data = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    device: { id: device.id, code: device.code },
    bundles,
    ops: ops.map(({ seq: _seq, ...o }) => o),
    files: await Promise.all(files.map(async ({ blob, ...f }) => ({ ...f, type: blob.type, data: await toBase64(blob) }))),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/**
 * Restores a backup made on this tablet. Only what is missing is added back; entries the server
 * already has are answered as duplicates when sent again, so restoring twice is harmless.
 */
export async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a QMAS tablet backup file.');
  }
  if (data?.format !== BACKUP_FORMAT || data.version !== 1) throw new Error('This is not a QMAS tablet backup file.');
  const device = await getDevice();
  if (!device) throw new Error('Set up this tablet with its device code first, then restore.');
  if (data.device.id !== device.id) throw new Error(`This backup is from tablet ${data.device.code}. Restore it on that tablet, or set this tablet up as ${data.device.code}.`);
  const haveOps = new Set((await store.listOps()).map((o) => o.opId));
  const haveFiles = new Set((await store.listFiles()).map((f) => f.localId));
  let restored = 0;
  for (const b of data.bundles) {
    if (!(await store.getBundle(b.id))) { await store.putBundle(b); restored += 1; }
  }
  for (const o of [...data.ops].sort((a, b) => (a.clientTime < b.clientTime ? -1 : 1))) {
    if (!haveOps.has(o.opId)) { await store.addOp(o); restored += 1; }
  }
  for (const { data: b64, type, ...f } of data.files) {
    if (!haveFiles.has(f.localId)) { await store.addFile({ ...f, blob: fromBase64(b64, type) }); restored += 1; }
  }
  notify();
  scheduleSync();
  return { restored };
}

let stopAutoSync = null;

/** Starts background sync (on reconnect and every minute). Starting twice is harmless. */
export function startAutoSync() {
  if (stopAutoSync) return stopAutoSync;
  const tick = () => { syncNow().catch(() => {}); };
  window.addEventListener('online', tick);
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  const id = setInterval(tick, 60_000);
  tick();
  stopAutoSync = () => {
    clearInterval(id);
    window.removeEventListener('online', tick);
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
    stopAutoSync = null;
  };
  return stopAutoSync;
}
