import { z } from 'zod';
import { optionalTrimmed, trimmed } from './common.js';

/**
 * Help & Support: anyone signed in can report a bug, a problem, a question, a suggestion or an
 * access request; holders of support.manage work the tickets. Labels are shared with the web app.
 */
export const SUPPORT_KINDS = Object.freeze([
  { value: 'BUG', label: 'Bug', hint: 'Something in QMAS is broken or shows an error' },
  { value: 'ISSUE', label: 'Problem', hint: 'I cannot finish my work: data wrong, stuck record, slow page' },
  { value: 'ACCESS', label: 'Access request', hint: 'I need a role, a plant or a permission' },
  { value: 'QUESTION', label: 'Question', hint: 'How do I do something in QMAS?' },
  { value: 'SUGGESTION', label: 'Suggestion', hint: 'An idea to make QMAS better' },
]);

export const SUPPORT_PRIORITIES = Object.freeze([
  { value: 'LOW', label: 'Low', hint: 'Whenever possible' },
  { value: 'MEDIUM', label: 'Medium', hint: 'Slows my work down' },
  { value: 'HIGH', label: 'High', hint: 'Stops my work; there is a workaround' },
  { value: 'CRITICAL', label: 'Critical', hint: 'Stops work for many people, no workaround' },
]);

export const SUPPORT_STATUSES = Object.freeze([
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'WAITING', label: 'Waiting for you' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
]);

/** The part of QMAS the ticket is about (free of permissions: everyone may pick any). */
export const SUPPORT_MODULES = Object.freeze([
  'Sign in & account',
  'Dashboard & tasks',
  'Incoming inspection (IMIR)',
  'Tablet inspection',
  'Deviation',
  'Defect notification & CAPA',
  'Inspection formats',
  'Reports & insights',
  'Master config',
  'Users & roles',
  'SAP sync',
  'Notifications & mail',
  'Other',
]);

const values = (list) => list.map((x) => x.value);

export const supportTicketCreateSchema = z.object({
  kind: z.enum(values(SUPPORT_KINDS), { error: 'Choose what kind of request this is.' }),
  module: z.enum(SUPPORT_MODULES, { error: 'Choose the part of QMAS.' }),
  priority: z.enum(values(SUPPORT_PRIORITIES)).default('MEDIUM'),
  title: trimmed('Subject', 150).refine((v) => v.length >= 5, 'Write a subject of at least 5 characters.'),
  description: trimmed('Description', 5000).refine((v) => v.length >= 10, 'Describe the problem in a few words (at least 10 characters).'),
  steps: optionalTrimmed('Steps', 3000),
  expected: optionalTrimmed('Expected result', 1000),
  reference: optionalTrimmed('Reference', 60),
  pageUrl: optionalTrimmed('Page', 500),
  clientInfo: z
    .object({
      browser: z.string().max(300).optional(),
      screen: z.string().max(30).optional(),
      language: z.string().max(20).optional(),
      online: z.boolean().optional(),
    })
    .optional(),
});

export const supportCommentSchema = z.object({
  body: trimmed('Message', 5000),
  internal: z.boolean().default(false),
});

export const supportUpdateSchema = z
  .object({
    status: z.enum(values(SUPPORT_STATUSES)).optional(),
    priority: z.enum(values(SUPPORT_PRIORITIES)).optional(),
    assignedTo: z.uuid().nullable().optional(),
    note: optionalTrimmed('Note', 2000),
  })
  .refine((v) => v.status || v.priority || v.assignedTo !== undefined, { message: 'Nothing to change.' });

export const supportListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  scope: z.enum(['mine', 'all', 'assigned']).default('mine'),
  status: z.enum([...values(SUPPORT_STATUSES), 'ACTIVE']).optional(),
  kind: z.enum(values(SUPPORT_KINDS)).optional(),
  priority: z.enum(values(SUPPORT_PRIORITIES)).optional(),
  flag: z.enum(['urgent', 'unassigned']).optional(),
  sort: z.enum(['ticketNo', 'createdAt', 'updatedAt', 'priority', 'status']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
