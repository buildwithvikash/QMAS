import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@qmas/shared';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { ok, query } from '../../shared/http.js';
import * as audit from './audit.service.js';

const DAY = 86_400_000;
const range = {
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  actorId: z.uuid().optional(),
};
// Default window: last 7 days; at most 92 days per query.
const withRange = (shape) =>
  z
    .object({ ...range, ...shape })
    .transform((v) => {
      const to = v.to ? new Date(v.to) : new Date();
      const from = v.from ? new Date(v.from) : new Date(to.getTime() - 7 * DAY);
      return { ...v, from, to };
    })
    .refine((v) => v.from < v.to, { message: '"From" must be before "to".', path: ['from'] })
    .refine((v) => v.to - v.from <= 92 * DAY, { message: 'Choose a range of at most 92 days.', path: ['from'] });

const changesQuery = withRange({
  table: z.string().regex(/^[a-z_]+\.[a-z_]+$/).optional(),
  rowPk: z.string().max(100).optional(),
  operation: z.enum(['I', 'U', 'D']).optional(),
});
const authQuery = withRange({ event: z.string().regex(/^[A-Z_]+$/).optional() });

const router = Router();
router.use(requirePermission(PERMISSIONS.AUDIT_VIEW));

router.get('/changes', validate({ query: changesQuery }), async (req, res) => {
  const { data, meta } = await audit.listChanges(query(req));
  ok(res, data, meta);
});

router.get('/auth-events', validate({ query: authQuery }), async (req, res) => {
  const { data, meta } = await audit.listAuthEvents(query(req));
  ok(res, data, meta);
});

router.get('/tables', async (_req, res) => ok(res, await audit.listTables()));

export default router;
