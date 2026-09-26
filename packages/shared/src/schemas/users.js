import { z } from 'zod';
import { listQuery, optionalTrimmed, password, rowVersion, trimmed } from './common.js';

const email = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v.toLowerCase()))
  .pipe(z.email('Enter a valid email address.').nullable())
  .nullable()
  .optional();

export const roleAssignmentSchema = z.object({
  roleCode: trimmed('Role', 40),
  plantId: z.number().int().positive().nullable(),
  validTo: z.iso.date('Use YYYY-MM-DD.').nullable().optional(),
});

export const userCreateSchema = z.object({
  employeeCode: trimmed('Employee code', 30).transform((v) => v.toUpperCase()),
  fullName: trimmed('Full name', 120),
  email,
  phone: optionalTrimmed('Phone', 20),
  temporaryPassword: password,
  roles: z.array(roleAssignmentSchema).max(30).default([]),
});

export const userUpdateSchema = z.object({
  fullName: trimmed('Full name', 120).optional(),
  email,
  phone: optionalTrimmed('Phone', 20),
  isActive: z.boolean().optional(),
  rowVersion,
});

export const userRolesSchema = z.object({
  roles: z.array(roleAssignmentSchema).max(30),
  rowVersion,
});

export const resetPasswordSchema = z.object({ temporaryPassword: password });

/** Administrator's lock on an account; the reason is shown in User Management. */
export const lockUserSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(300) });

export const userListQuery = listQuery.extend({
  roleCode: z.string().trim().max(40).optional(),
  plantId: z.coerce.number().int().positive().optional(),
  status: z.enum(['online', 'locked', 'inactive', 'mustChange', 'active', 'multiple']).optional(),
});

export const rolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1).max(60)).max(200),
});

// ── Roles (Roles & Permissions screen) ───────────────────────────────────────
const roleDetails = {
  name: trimmed('Role name', 60),
  description: optionalTrimmed('Description', 200),
  department: trimmed('Department', 40),
  viewScope: z.enum(['OWN_PLANT', 'ALL_PLANTS']),
  actionScope: z.enum(['PLANT', 'ALL']),
  requiresPlant: z.boolean(),
};

/** A new custom role; `copyFrom` starts it with that role's permissions (Duplicate). */
export const roleCreateSchema = z.object({
  ...roleDetails,
  copyFrom: z.string().regex(/^[A-Z_]+$/).optional(),
  permissions: z.array(z.string().trim().min(1).max(60)).max(200).optional(),
});

/** Changes to a role. Built-in roles accept only `description`. */
export const roleUpdateSchema = z.object({
  ...Object.fromEntries(Object.entries(roleDetails).map(([k, v]) => [k, v.optional()])),
  isActive: z.boolean().optional(),
});
