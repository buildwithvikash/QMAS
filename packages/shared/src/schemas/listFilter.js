import { z } from 'zod';

/**
 * Dynamic list filters: any field of a list, any sensible condition, combined with "all" or "any".
 * Sent as ?filter=<JSON>. The server checks every field against its own whitelist and builds
 * parameterised SQL; nothing from the user reaches the SQL text.
 */

export const FILTER_OPERATORS = Object.freeze({
  text: [
    { op: 'contains', label: 'contains' },
    { op: 'not_contains', label: 'does not contain' },
    { op: 'equals', label: 'is exactly' },
    { op: 'starts_with', label: 'starts with' },
    { op: 'is_empty', label: 'is empty', noValue: true },
    { op: 'not_empty', label: 'is not empty', noValue: true },
  ],
  number: [
    { op: 'eq', label: '=' },
    { op: 'ne', label: '≠' },
    { op: 'gt', label: '>' },
    { op: 'gte', label: '≥' },
    { op: 'lt', label: '<' },
    { op: 'lte', label: '≤' },
    { op: 'between', label: 'between', range: true },
  ],
  date: [
    { op: 'on', label: 'on' },
    { op: 'before', label: 'before' },
    { op: 'after', label: 'after' },
    { op: 'between', label: 'between', range: true },
    { op: 'last_days', label: 'in the last … days', days: true },
  ],
  enum: [
    { op: 'in', label: 'is any of', multi: true },
    { op: 'not_in', label: 'is none of', multi: true },
  ],
  bool: [{ op: 'is', label: 'is' }],
});

const scalar = z.union([z.string().max(100), z.number().finite(), z.boolean()]);
export const filterRuleSchema = z.object({
  field: z.string().regex(/^[a-zA-Z]{1,40}$/),
  op: z.string().regex(/^[a-z_]{1,20}$/),
  value: z.union([scalar, z.array(scalar).max(40)]).nullable().optional(),
});
export const filterSpecSchema = z.object({
  mode: z.enum(['all', 'any']).default('all'),
  rules: z.array(filterRuleSchema).max(12),
});

/** Query-string form: JSON text → validated spec (a malformed value is a 422, not a 500). */
export const filterParam = z
  .string()
  .max(4000)
  .transform((s, ctx) => {
    try {
      return JSON.parse(s);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'The filter is not valid.' });
      return z.NEVER;
    }
  })
  .pipe(filterSpecSchema);

const IMIR_STATUS_OPTIONS = [
  ['AWAITING_FORMAT', 'Waiting for format'], ['OPEN', 'To inspect'], ['IN_INSPECTION', 'Inspecting'], ['SUBMITTED', 'With Incharge'],
  ['WITH_IQC_HEAD', 'With IQC Head'], ['DEPT_REVIEW', 'With SCM / VD'], ['IQC_HEAD_FINAL', 'IQC Head decision'], ['SENIOR_ESCALATION', 'Escalated'],
  ['UNDER_DEVIATION', 'Under deviation'], ['QTY_VERIFICATION', 'Quantity check'], ['CLOSED_ACCEPTED', 'Closed, accepted'], ['CLOSED_REJECTED', 'Closed, rejected'],
  ['CLOSED_UNDER_DEVIATION', 'Closed, under deviation'], ['AUTO_CLOSED', 'Auto-closed'],
];
const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));

/**
 * Filterable fields per list: key, label, type and, for enums, the choices. The server maps each
 * key to a SQL expression; the screens build the filter from these.
 */
export const LIST_FIELDS = Object.freeze({
  imirs: [
    { key: 'imirNo', label: 'IMIR no.', type: 'text' },
    { key: 'grnNo', label: 'GRN no.', type: 'text' },
    { key: 'sapLotNo', label: 'SAP lot', type: 'text' },
    { key: 'invoiceNo', label: 'Invoice no.', type: 'text' },
    { key: 'itemCode', label: 'Item code', type: 'text' },
    { key: 'itemDescription', label: 'Item description', type: 'text' },
    { key: 'itemCategory', label: 'Item category', type: 'text' },
    { key: 'vendorCode', label: 'Vendor code', type: 'text' },
    { key: 'vendorName', label: 'Vendor name', type: 'text' },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'plant', label: 'Plant', type: 'text' },
    { key: 'inspectedBy', label: 'Inspected by', type: 'text' },
    { key: 'status', label: 'Status', type: 'enum', options: opts(IMIR_STATUS_OPTIONS) },
    { key: 'result', label: 'Result', type: 'enum', options: opts([['OK', 'OK'], ['NOK', 'Not OK']]) },
    { key: 'grnDate', label: 'GRN date', type: 'date' },
    { key: 'receivedAt', label: 'Received', type: 'date' },
    { key: 'submittedAt', label: 'Submitted', type: 'date' },
    { key: 'inwardQty', label: 'Inward qty', type: 'number' },
    { key: 'sampleSize', label: 'Sample size', type: 'number' },
    { key: 'hasDeviation', label: 'Has a deviation', type: 'bool' },
    { key: 'hasDn', label: 'Has a DN', type: 'bool' },
  ],
  deviations: [
    { key: 'deviationNo', label: 'Deviation no.', type: 'text' },
    { key: 'imirNo', label: 'IMIR no.', type: 'text' },
    { key: 'itemCode', label: 'Item code', type: 'text' },
    { key: 'itemDescription', label: 'Item description', type: 'text' },
    { key: 'vendorName', label: 'Vendor name', type: 'text' },
    { key: 'vendorCode', label: 'Vendor code', type: 'text' },
    { key: 'plant', label: 'Plant', type: 'text' },
    { key: 'department', label: 'Department', type: 'enum', options: opts([['SCM', 'SCM'], ['VD', 'VD']]) },
    { key: 'stage', label: 'Stage', type: 'enum', options: opts([['INITIATOR', 'With initiator'], ['SUB_HEAD', 'With Sub-Head'], ['HEAD', 'With Head'], ['FINAL', 'IQC Head decision'], ['SENIOR', 'Senior escalation'], ['UNDER_DEVIATION', 'Awaiting quantities'], ['QTY_VERIFICATION', 'Quantity check'], ['CLOSED', 'Closed']]) },
    { key: 'severity', label: 'Severity', type: 'enum', options: opts([['MINOR', 'Minor'], ['MAJOR', 'Major'], ['CRITICAL', 'Critical']]) },
    { key: 'action', label: 'Action', type: 'enum', options: opts([['UAI', 'Use As Is'], ['SEGREGATION', 'Segregation'], ['REWORK', 'Rework']]) },
    { key: 'seniorEffective', label: 'Senior decision', type: 'enum', options: opts([['APPROVE', 'Approve'], ['REJECT', 'Reject'], ['CHANGE_TYPE', 'Change type']]) },
    { key: 'outcome', label: 'Outcome', type: 'enum', options: opts([['ACCEPTED_UNDER_DEVIATION', 'Accepted under deviation'], ['REJECTED', 'Rejected'], ['AUTO_CLOSED', 'Auto-closed']]) },
    { key: 'deviationQty', label: 'Deviation qty', type: 'number' },
    { key: 'createdAt', label: 'Raised', type: 'date' },
    { key: 'closedAt', label: 'Closed', type: 'date' },
  ],
  dns: [
    { key: 'dnNo', label: 'DN no.', type: 'text' },
    { key: 'imirNo', label: 'IMIR no.', type: 'text' },
    { key: 'itemCode', label: 'Item code', type: 'text' },
    { key: 'itemDescription', label: 'Item description', type: 'text' },
    { key: 'vendorName', label: 'Vendor name', type: 'text' },
    { key: 'vendorCode', label: 'Vendor code', type: 'text' },
    { key: 'plant', label: 'Plant', type: 'text' },
    { key: 'status', label: 'Status', type: 'enum', options: opts([['OPEN', 'CAPA awaited'], ['CAPA_SUBMITTED', 'CAPA with IQC Head'], ['CLOSED', 'Closed']]) },
    { key: 'capaApplicable', label: 'CAPA applicable', type: 'bool' },
    { key: 'defectiveQty', label: 'Defective qty', type: 'number' },
    { key: 'dnDate', label: 'DN date', type: 'date' },
    { key: 'capaDueAt', label: 'CAPA due', type: 'date' },
    { key: 'closedAt', label: 'Closed', type: 'date' },
  ],
});
