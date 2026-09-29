import os from 'node:os';
import { getPool } from '../../db/pool.js';
import { APP_VERSION } from './errorLog.js';

export const BEAT_EVERY_MS = 30_000;
/** A process whose last beat is older than this is shown as stopped. */
export const BEAT_STALE_SEC = 90;

/**
 * Writes this process's heartbeat now and every 30 s (kind 'API' or 'WORKER'), so System Health
 * can tell which API and worker processes are running. Returns a stop function.
 */
export function startHeartbeat(kind, log) {
  const host = os.hostname();
  const component = `${kind.toLowerCase()}:${host}:${process.pid}`;
  const startedAt = new Date();
  let warned = false;
  const beat = async () => {
    try {
      const mem = process.memoryUsage();
      await getPool().query(
        `INSERT INTO core.service_heartbeat (component, kind, host, pid, version, started_at, last_beat, info)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
         ON CONFLICT (component) DO UPDATE SET last_beat = now(), version = EXCLUDED.version, info = EXCLUDED.info`,
        [component, kind, host, process.pid, APP_VERSION, startedAt, JSON.stringify({ rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), node: process.version })],
      );
      // Processes that stopped more than a day ago are forgotten.
      await getPool().query("DELETE FROM core.service_heartbeat WHERE last_beat < now() - interval '1 day'");
      warned = false;
    } catch (err) {
      if (!warned) log?.warn({ err: err.message }, 'heartbeat failed');
      warned = true;
    }
  };
  beat();
  const timer = setInterval(beat, BEAT_EVERY_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    try {
      // Kept (marked stopped) so System Health and the alerts can say it stopped, not that it never ran.
      await getPool().query(`UPDATE core.service_heartbeat SET info = coalesce(info, '{}'::jsonb) || jsonb_build_object('stoppedAt', now()) WHERE component = $1`, [component]);
    } catch {
      /* stopping anyway */
    }
  };
}
