import { getPool } from './pool.js';

/**
 * Runs `fn(client)` in one transaction. The acting user and request id are stored as
 * transaction-local settings so the audit trigger can record who made each change.
 * Repositories take a `db` argument that is either this client or the pool.
 */
export async function withTransaction(ctx, fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)",
      [ctx?.userId ?? '', ctx?.requestId ?? ''],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Audit context from an Express request. */
export const txContext = (req) => ({ userId: req.user?.id, requestId: req.id });
