import { Router } from 'express';
import { PERMISSIONS, uuidParam } from '@qmas/shared';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, ok } from '../../shared/http.js';
import * as ai from './ai.service.js';

const router = Router();
const P = PERMISSIONS;
const assist = requirePermission(P.AI_ASSIST);
const refreshBody = z.object({ refresh: z.boolean().default(false), cycleNo: z.number().int().positive().optional() }).default({});

router.get('/status', requirePermission(P.DASHBOARD_VIEW), (_req, res) => ok(res, ai.status()));

router.post('/imirs/:id/summary', assist, validate({ params: uuidParam, body: refreshBody }), async (req, res) => ok(res, await ai.imirSummary(req.params.id, req.user, body(req))));
router.post('/dns/:id/capa-assessment', assist, validate({ params: uuidParam, body: refreshBody }), async (req, res) => ok(res, await ai.capaAssessment(req.params.id, req.user, body(req))));
router.post('/dns/:id/root-cause', assist, validate({ params: uuidParam, body: refreshBody }), async (req, res) => ok(res, await ai.rootCause(req.params.id, req.user, body(req))));

router.post('/search', assist, validate({ body: z.object({ q: z.string().trim().min(3).max(300) }) }), async (req, res) => ok(res, await ai.searchInWords(body(req).q, req.user)));

const chatBody = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) })).min(1).max(20)
    .refine((m) => m.at(-1).role === 'user', 'The last message must be the question.'),
});
router.post('/chat', assist, validate({ body: chatBody }), async (req, res) => ok(res, await ai.chat(body(req).messages, req.user)));

// Voice: the inspector's dictated observation, tidied into inspection text.
const tidyBody = z.object({
  text: z.string().trim().min(1).max(2000),
  checkpoint: z.string().max(200).optional(),
  specification: z.string().max(200).optional(),
  unit: z.string().max(20).optional(),
});
router.post('/observations/tidy', requirePermission(P.IMIR_INSPECT), validate({ body: tidyBody }), async (req, res) => ok(res, await ai.tidyObservation(body(req), req.user)));

export default router;
