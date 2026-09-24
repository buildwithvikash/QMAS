/**
 * On-device storage for offline inspection: IndexedDB in the installed web app (tablets use the
 * same app as desktops; there is no separate native app). Persistent storage is requested so
 * Android does not evict it, and unsent work can be saved to a backup file (engine.exportBackup).
 *
 *   meta    device registration and the last signed-in user
 *   bundles checked-out IMIRs with the inspector's local entries
 *   ops     queued SAVE / SUBMIT operations, applied in order when online
 *   files   photos / PDFs waiting to upload
 */
const DB_NAME = 'qmas-offline';
const VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('meta');
      db.createObjectStore('bundles', { keyPath: 'id' });
      const ops = db.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
      ops.createIndex('imirId', 'imirId');
      const files = db.createObjectStore('files', { keyPath: 'localId' });
      files.createIndex('imirId', 'imirId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

// ── meta ──────────────────────────────────────────────────────────────────────
export const getMeta = (key) => tx('meta', 'readonly', (s) => req(s.get(key)));
export const setMeta = (key, value) => tx('meta', 'readwrite', (s) => s.put(value, key));
export const deleteMeta = (key) => tx('meta', 'readwrite', (s) => s.delete(key));

// ── bundles ───────────────────────────────────────────────────────────────────
export const getBundle = (id) => tx('bundles', 'readonly', (s) => req(s.get(id)));
export const putBundle = (bundle) => tx('bundles', 'readwrite', (s) => s.put(bundle));
export const deleteBundle = (id) => tx('bundles', 'readwrite', (s) => s.delete(id));
export const listBundles = () => tx('bundles', 'readonly', (s) => req(s.getAll()));

// ── ops ───────────────────────────────────────────────────────────────────────
export const addOp = (op) => tx('ops', 'readwrite', (s) => s.add(op));
export const listOps = () => tx('ops', 'readonly', (s) => req(s.getAll()));
export const deleteOps = (seqs) => tx('ops', 'readwrite', (s) => seqs.forEach((k) => s.delete(k)));

// ── files ─────────────────────────────────────────────────────────────────────
export const addFile = (file) => tx('files', 'readwrite', (s) => s.put(file));
export const listFiles = () => tx('files', 'readonly', (s) => req(s.getAll()));
export const deleteFile = (localId) => tx('files', 'readwrite', (s) => s.delete(localId));

/** Asks the browser not to evict our data when the device runs low on space. */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Whether storage is protected from eviction, and how much is used. */
export async function storageStatus() {
  try {
    const [persisted, estimate] = await Promise.all([navigator.storage?.persisted?.() ?? false, navigator.storage?.estimate?.() ?? null]);
    return { persisted: !!persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, supported: !!navigator.storage?.persist };
  } catch {
    return { persisted: false, usage: null, quota: null, supported: false };
  }
}
