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

/** "Forgot password": the employee code or e-mail address of the account. */
export const forgotPasswordSchema = z.object({
  login: z.string({ error: 'Enter your employee code or e-mail address.' }).trim().min(1, 'Enter your employee code or e-mail address.').max(120),
});

/** Setting a new password from an e-mailed reset link. */
export const resetWithTokenSchema = z
  .object({
    token: z.string().trim().regex(/^[A-Za-z0-9_-]{20,100}$/, 'This reset link is not valid.'),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'The two passwords do not match.', path: ['confirmPassword'] });
