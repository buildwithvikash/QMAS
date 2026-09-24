import { Router } from 'express';
import { notificationListQuery } from '@qmas/shared';
import { z } from 'zod';
import { getPool } from '../../db/pool.js';
import { validate } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { noContent, ok, params, query } from '../../shared/http.js';
import { camelRows } from '../../shared/sql.js';

/** The signed-in user's own notifications (bell). */
const router = Router();

router.get('/', validate({ query: notificationListQuery }), async (req, res) => {
  const { unread, limit } = query(req);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, kind, title, body, link, created_at, read_at FROM core.notification
      WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL) ORDER BY created_at DESC, id DESC LIMIT $3`,
    [req.user.id, unread ?? null, limit],
  );
  const { rows: c } = await pool.query('SELECT count(*)::int AS n FROM core.notification WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  ok(res, camelRows(rows).map((r) => ({ ...r, id: Number(r.id) })), { unread: c[0].n });
});

router.post('/read-all', async (req, res) => {
  await getPool().query('UPDATE core.notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  noContent(res);
});

router.post('/:id/read', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => {
  const { rowCount } = await getPool().query('UPDATE core.notification SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2', [params(req).id, req.user.id]);
  if (!rowCount) throw AppError.notFound('Notification');
  noContent(res);
});

export default router;
