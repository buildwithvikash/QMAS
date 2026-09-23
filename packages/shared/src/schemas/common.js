import { z } from 'zod';

export const trimmed = (label, max = 200) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`);

export const optionalTrimmed = (label, max = 200) =>
  z.string().trim().max(max, `${label} must be at most ${max} characters.`).transform((v) => (v === '' ? null : v)).nullable().optional();

export const code = (label, max = 30) =>
  trimmed(label, max).transform((v) => v.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_\-/.]*$/, `${label} may only contain letters, digits and - _ / .`));

export const idParam = z.object({ id: z.coerce.number().int().positive('Invalid id.') });
export const uuidParam = z.object({ id: z.uuid('Invalid id.') });

export const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

/** List endpoints: ?page=1&pageSize=25&q=...&sort=name&order=asc */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  isActive: booleanQuery.optional(),
});

export const rowVersion = z.number({ error: 'rowVersion is required.' }).int().min(1);

export const PASSWORD_RULES_TEXT = 'At least 10 characters, with at least one letter and one digit.';
export const password = z
  .string({ error: 'Password is required.' })
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one digit.');
