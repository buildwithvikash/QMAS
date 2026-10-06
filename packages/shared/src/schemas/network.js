import { z } from 'zod';
import { listQuery, rowVersion, trimmed } from './common.js';

/** Network access control: company network ranges and admin-approved external access. */

/** Longest external access an admin can grant at once. */
export const EXTERNAL_ACCESS_MAX_DAYS = 90;

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

/** "10.0.0.0/8", "203.0.113.7" (one address) or an IPv6 range like "fc00::/7". */
export function isCidr(value) {
  const [addr, bits, extra] = String(value).trim().split('/');
  if (extra !== undefined || !addr) return false;
  const v4 = IPV4.test(addr);
  const v6 = !v4 && IPV6.test(addr) && addr.includes(':');
  if (!v4 && !v6) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (v4 ? 32 : 128);
}

export const networkSettingsSchema = z.object({
  internalNetworks: z
    .array(z.string().trim().refine(isCidr, 'Enter an address or range like 10.0.0.0/8 or 203.0.113.7.'))
    .min(1, 'Keep at least one company network range.')
    .max(100)
    .transform((a) => [...new Set(a)]),
  rowVersion,
});

const at = (label) => z.iso.datetime({ offset: true, error: `Enter the ${label}.` });

export const externalAccessGrantSchema = z
  .object({
    userId: z.uuid({ error: 'Choose the user.' }),
    startsAt: at('start'),
    endsAt: at('end'),
    reason: trimmed('Reason', 1000),
  })
  .refine((g) => new Date(g.endsAt) > new Date(g.startsAt), { path: ['endsAt'], message: 'The end must be after the start.' })
  .refine((g) => new Date(g.endsAt) - new Date(g.startsAt) <= EXTERNAL_ACCESS_MAX_DAYS * 86_400_000, {
    path: ['endsAt'], message: `External access can be granted for at most ${EXTERNAL_ACCESS_MAX_DAYS} days at a time.`,
  })
  .refine((g) => new Date(g.endsAt) > new Date(), { path: ['endsAt'], message: 'The end must be in the future.' });

export const externalAccessRevokeSchema = z.object({ reason: trimmed('Reason for revoking', 1000) });

export const EXTERNAL_ACCESS_STATES = Object.freeze(['ACTIVE', 'UPCOMING', 'EXPIRED', 'REVOKED']);

export const externalAccessListQuery = listQuery.extend({
  state: z.enum(EXTERNAL_ACCESS_STATES).optional(),
  userId: z.uuid().optional(),
});
