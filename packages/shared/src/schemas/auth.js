import { z } from 'zod';
import { password, trimmed } from './common.js';

export const loginSchema = z.object({
  employeeCode: trimmed('Employee code', 30),
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(128),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: 'Current password is required.' }).min(1, 'Current password is required.'),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'The new password must be different from the current one.', path: ['newPassword'] });
