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
  q: z.string().trim().max(100).optional(),
  format: z.enum(['csv']).optional(),
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

/** CSV of the filtered list (?format=csv), named after the period. */
async function sendCsv(res, kind, f) {
  const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${kind}_${day(f.from)}_to_${day(new Date(f.to.getTime() - 1))}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(await audit.exportCsv(kind, f));
}

router.get('/changes', validate({ query: changesQuery }), async (req, res) => {
  if (query(req).format === 'csv') return sendCsv(res, 'changes', query(req));
  const { data, meta } = await audit.listChanges(query(req));
  ok(res, data, meta);
});

router.get('/auth-events', validate({ query: authQuery }), async (req, res) => {
  if (query(req).format === 'csv') return sendCsv(res, 'sign-ins', query(req));
  const { data, meta } = await audit.listAuthEvents(query(req));
  ok(res, data, meta);
});

router.get('/summary', validate({ query: withRange({}) }), async (req, res) => ok(res, await audit.summary(query(req))));
router.get('/actors', validate({ query: withRange({}) }), async (req, res) => ok(res, await audit.actors(query(req))));

router.get('/tables', async (_req, res) => ok(res, await audit.listTables()));

export default router;
