import { getPool } from '../../db/pool.js';
import { AppError } from '../../shared/AppError.js';
import { mockSanClient } from './mockSan.js';

/**
 * SAN/SIR adapter. The rest of the app only calls `lookupSan`; switching to the real SAN/SIR API
 * means adding a client with the same `lookup({ vendorCode, itemCode })` contract and selecting it
 * with SAN_MODE. Returns { found, reference?, checkpoints? } where checkpoints use the QMAS format model.
 */
const CLIENTS = { mock: mockSanClient };
const TIMEOUT_MS = 10_000;

function client() {
  const mode = process.env.SAN_MODE ?? 'mock';
  const c = CLIENTS[mode];
  if (!c) throw new Error(`SAN_MODE "${mode}" is not available yet; only "mock" is implemented`);
  return c;
}

export async function lookupSan({ vendorCode, itemCode }, { userId } = {}) {
  const started = Date.now();
  let result;
  try {
    result = await Promise.race([
      client().lookup({ vendorCode, itemCode }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
  } catch (err) {
    throw new AppError(503, 'SAN/SIR is not responding. Try again later, or create the format as new.', { code: 'SAN_UNAVAILABLE', cause: err });
  }
  await getPool().query(
    `INSERT INTO intg.san_lookup_log (vendor_code, item_code, found, reference, response, duration_ms, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [vendorCode, itemCode, result.found, result.reference ?? null, result, Date.now() - started, userId ?? null],
  );
  return result;
}
