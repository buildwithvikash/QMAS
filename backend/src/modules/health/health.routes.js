import { Router } from 'express';
import { getPool } from '../../db/pool.js';

const router = Router();

/** Liveness: the process is up (used by the container health check). */
router.get('/health', (_req, res) => res.json({ status: 'ok' }));

/** Readiness: the database answers (used by the load balancer target group). */
router.get('/ready', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

export default router;
