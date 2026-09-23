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

export const userListQuery = listQuery.extend({
  roleCode: z.string().trim().max(40).optional(),
  plantId: z.coerce.number().int().positive().optional(),
});

export const rolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1).max(60)).max(200),
});
