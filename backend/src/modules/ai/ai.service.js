import { createHash } from 'node:crypto';
import {
  deviationListQuery, dnListQuery, FILTER_OPERATORS, imirListQuery, LIST_FIELDS, PERMISSIONS,
} from '@qmas/shared';
import { z } from 'zod';
import { getPool } from '../../db/pool.js';
import { AppError } from '../../shared/AppError.js';
import { camelRows } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';
import * as deviationService from '../deviation/deviation.service.js';
import * as dnService from '../dn/dn.service.js';
import * as imirService from '../imir/imir.service.js';
import { lotInsights, overview } from '../insights/insights.service.js';
import { aiConfigured, aiModel, aiProvider, askStructured, chatWithTools } from './claude.js';

/**
 * AI features (Claude): inspection summary, CAPA assessment, root-cause suggestions, search in
 * words, the quality chatbot and tidying a spoken observation. Claude only sees data the user may
 * see (every query goes through the same plant scope as the screens), answers from that data, and
 * never writes anything; people decide.
 */

const BRIEF = 'You assist the incoming quality (IQC) team of Western Refrigeration, an Indian refrigeration equipment maker. Material from vendors is inspected lot by lot against inspection formats (dimensional readings against limits, visual checks, reliability tests). A lot is OK or NOK (not OK); a NOK lot may go to a deviation (SCM/VD decide use-as-is, segregation or rework) and a defect notification (DN) asks the vendor for CAPA.';
const RULES = 'Use only the data given. Never invent values, dates, document numbers or causes presented as fact; if the data does not say, say so. Write plain, short English for shop-floor quality staff; numbers with their units.';

const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const day = (t) => (t ? IST.format(new Date(t)) : '—');
const hash = (s) => createHash('sha256').update(s).digest('hex');

export function status() {
  return { configured: aiConfigured(), provider: aiConfigured() ? aiProvider() : null, model: aiConfigured() ? aiModel() : null };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

async function cached(kind, entityId, inputHash) {
  const { rows } = await getPool().query(
    `SELECT r.output, r.model, r.created_at, u.full_name AS created_by_name FROM qms.ai_result r LEFT JOIN core.app_user u ON u.id = r.created_by
      WHERE r.kind = $1 AND r.entity_id = $2 AND r.input_hash = $3 ORDER BY r.created_at DESC LIMIT 1`,
    [kind, entityId, inputHash],
  );
  return rows[0] ? { ...rows[0].output, meta: { model: rows[0].model, at: rows[0].created_at, by: rows[0].created_by_name, cached: true } } : null;
}
async function store(kind, entityId, inputHash, output, model, userId) {
  await getPool().query('INSERT INTO qms.ai_result (kind, entity_id, input_hash, output, model, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [kind, entityId, inputHash, output, model, userId]);
  return { ...output, meta: { model, at: new Date().toISOString(), cached: false } };
}

/** Latest stored result for a record (whatever its inputs), for showing without calling the AI. */
export async function latest(kind, entityId) {
  const { rows } = await getPool().query(
    `SELECT r.output, r.model, r.created_at, r.input_hash, u.full_name AS created_by_name FROM qms.ai_result r LEFT JOIN core.app_user u ON u.id = r.created_by
      WHERE r.kind = $1 AND r.entity_id = $2 ORDER BY r.created_at DESC LIMIT 1`,
    [kind, entityId],
  );
  return rows[0] ?? null;
}

// ── 6. Inspection summary ─────────────────────────────────────────────────────

function lotContext(m, ins) {
  const lines = [
    `IMIR ${m.imirNo ?? '(not numbered)'}, plant ${m.plantSapCode} ${m.plantName}. Status ${m.status}. Result ${m.result ?? 'not submitted yet'}.`,
    `Item ${m.itemCode} ${m.itemDescription}${m.model ? `, model ${m.model}` : ''}. Vendor ${m.vendorName} (${m.vendorCode}). GRN ${m.grnNo} ${day(m.grnDate)}, inward ${m.inwardQty} ${m.uom ?? ''}, sample size ${m.sampleSize ?? '—'}.`,
    `Inspected by ${m.inspectedByName ?? '—'}${m.submittedAt ? `, submitted ${day(m.submittedAt)}` : ''}.`,
  ];
  if (m.inspectorRemark) lines.push(`Inspector remark: ${m.inspectorRemark}`);
  lines.push('Checkpoints (name | spec | readings | result):');
  for (const c of m.checkpoints) {
    const vals = m.cells.filter((x) => x.checkpointUid === c.uid).map((x) => (x.value ?? (x.ok === null || x.ok === undefined ? null : x.ok ? 'OK' : 'NOK')) + (x.decision === 'NOK' ? '(NOK)' : '')).filter((x) => x !== null);
    const spec = c.section === 'DIMENSIONAL' ? `${c.lsl ?? '-'}..${c.usl ?? '-'} ${c.uom ?? ''}` : c.specification ?? '';
    const extra = [c.textObservation && `observation: ${c.textObservation}`, c.inspectorRemark && `inspector: ${c.inspectorRemark}`, c.inchargeRemark && `incharge: ${c.inchargeRemark}`].filter(Boolean).join('; ');
    lines.push(`- ${c.checkpoint} [${c.section}] | ${spec} | ${vals.join(', ') || '—'} | ${c.result ?? c.manualResult ?? '—'}${extra ? ` | ${extra}` : ''}`);
  }
  if (m.deviation) lines.push(`Deviation ${m.deviation.deviationNo}: stage ${m.deviation.stage}${m.deviation.outcome ? `, outcome ${m.deviation.outcome}` : ''}.`);
  if (m.dn) lines.push(`Defect notification ${m.dn.dnNo}: ${m.dn.status}.`);
  const steps = (m.history ?? []).map((h) => `${day(h.at)} ${h.action}${h.actingRoleName ? ` by ${h.actingRoleName}` : ''}${h.remark ? `: "${h.remark}"` : ''}`);
  if (steps.length) lines.push(`Workflow: ${steps.join(' → ')}`);
  if (ins) {
    lines.push(`Supplier risk: ${ins.supplier.level} (${ins.supplier.reasons.join('; ')}).`);
    for (const a of ins.alerts) lines.push(`History alert: ${a.checkpoint}: ${a.text}.`);
  }
  return lines.join('\n');
}

const SummarySchema = z.object({
  summary: z.string().describe('2 to 4 sentences: result, what failed and by how much, anything critical, where the lot stands'),
  highlights: z.array(z.object({ text: z.string(), tone: z.enum(['bad', 'warn', 'good', 'info']) })).max(4).describe('short facts worth a glance'),
});

export async function imirSummary(id, user, { refresh = false } = {}) {
  const m = await imirService.detail(id, user);
  if (m.status === 'AWAITING_FORMAT') throw AppError.conflict('This lot has no inspection yet.');
  const ins = await lotInsights(id, user).catch(() => null);
  const context = lotContext(m, ins);
  const key = hash(`${aiModel()}\n${context}`);
  if (!refresh) {
    const hit = await cached('IMIR_SUMMARY', id, key);
    if (hit) return hit;
  }
  const { output, model } = await askStructured({
    feature: 'IMIR_SUMMARY', userId: user.id, schema: SummarySchema, maxTokens: 1500,
    system: `${BRIEF}\n${RULES}\nWrite a concise summary of one inspection for the Incharge: 2 to 4 sentences, the result first, then failed characteristics with the reading against the limit, then anything critical (repeat defects, drift, supplier risk), then where the lot stands in the workflow.`,
    prompt: `Inspection data:\n${context}`,
  });
  return store('IMIR_SUMMARY', id, key, output, model, user.id);
}

// ── 4. CAPA assessment ────────────────────────────────────────────────────────

const words = (s) => new Set(String(s ?? '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
function similarity(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}

/** The vendor's earlier CAPAs (other DNs), with how close each is to this one's wording. */
async function earlierCapas(dn, capa) {
  const { rows } = await getPool().query(
    `SELECT n.dn_no, n.created_at, i.item_code, c.cycle_no, c.root_cause, c.corrective_action, c.review_decision
       FROM qms.dn_capa c JOIN qms.defect_notification n ON n.id = c.dn_id JOIN mst.item i ON i.id = n.item_id
      WHERE n.vendor_id = $1 AND n.id <> $2 ORDER BY c.submitted_at DESC LIMIT 20`,
    [dn.vendorId, dn.id],
  );
  const text = `${capa.rootCause ?? ''} ${capa.correctiveAction ?? ''}`;
  return camelRows(rows).map((r) => ({ ...r, similarity: Math.round(similarity(text, `${r.rootCause ?? ''} ${r.correctiveAction ?? ''}`) * 100) / 100 }));
}

const ELEMENTS = ['ROOT_CAUSE', 'CONTAINMENT', 'CORRECTIVE_ACTION', 'PREVENTIVE_ACTION', 'EFFECTIVENESS_EVIDENCE'];
const CapaSchema = z.object({
  overall: z.enum(['ADEQUATE', 'NEEDS_WORK', 'INADEQUATE']),
  summary: z.string().describe('2 to 3 sentences for the reviewer'),
  elements: z.array(z.object({
    element: z.enum(ELEMENTS),
    rating: z.enum(['GOOD', 'WEAK', 'MISSING']),
    finding: z.string().describe('one sentence: what is there or missing'),
  })).describe('one entry for each of the five elements'),
  repetitive: z.object({
    isRepetitive: z.boolean(),
    similarTo: z.array(z.string()).describe('DN numbers of earlier CAPAs this one repeats'),
    note: z.string(),
  }),
  askVendor: z.array(z.string()).max(5).describe('questions or evidence to ask the vendor for'),
});

export async function capaAssessment(dnId, user, { cycleNo = null, refresh = false } = {}) {
  const dn = await dnService.detail(dnId, user);
  const capa = cycleNo ? dn.capas.find((c) => c.cycleNo === Number(cycleNo)) : dn.capas.at(-1);
  if (!capa) throw AppError.conflict('No CAPA has been entered for this DN yet.');
  const earlier = await earlierCapas(dn, capa);
  const context = [
    `DN ${dn.dnNo}, vendor ${dn.vendorName} (${dn.vendorCode}), item ${dn.itemCode} ${dn.itemDescription}. Defective ${dn.defectiveQty ?? '—'} of ${dn.checkedQty ?? '—'} checked.`,
    `Defect: ${dn.defect ?? '—'}. Immediate correction by us: ${dn.correction ?? '—'}.`,
    'Defect lines:', ...dn.lines.map((l) => `- ${l.parameter}: spec ${l.specification ?? '—'}, observed ${l.observation ?? '—'}`),
    `CAPA cycle ${capa.cycleNo} from the vendor:`,
    `Root cause: ${capa.rootCause ?? '—'}`, `Corrective action: ${capa.correctiveAction ?? '—'}`,
    `Target date: ${capa.targetDate ?? '—'}. Closing date: ${capa.closingDate ?? '—'}. Responsibility: ${capa.responsibility ?? '—'}. Remark: ${capa.remark ?? '—'}.`,
    `Files attached to this CAPA: ${dn.capaFiles.filter((f) => f.cycleNo === capa.cycleNo).map((f) => f.fileName).join(', ') || 'none'} (names only; contents not shown).`,
    ...(dn.capas.filter((c) => c.cycleNo < capa.cycleNo).map((c) => `Earlier cycle ${c.cycleNo} of this DN was ${c.reviewDecision ?? 'not reviewed'}${c.reviewRemark ? `: "${c.reviewRemark}"` : ''}.`)),
    earlier.length ? "This vendor's earlier CAPAs on other DNs (DN | item | root cause | action | wording overlap 0-1):" : "This vendor has no earlier CAPAs on other DNs.",
    ...earlier.map((e) => `- ${e.dnNo} | ${e.itemCode} | ${e.rootCause ?? '—'} | ${e.correctiveAction ?? '—'} | ${e.similarity}`),
  ].join('\n');
  const key = hash(`${aiModel()}\n${context}`);
  if (!refresh) {
    const hit = await cached('CAPA_ASSESSMENT', capa.id, key);
    if (hit) return { ...hit, cycleNo: capa.cycleNo };
  }
  const { output, model } = await askStructured({
    feature: 'CAPA_ASSESSMENT', userId: user.id, schema: CapaSchema, maxTokens: 3000,
    system: `${BRIEF}\n${RULES}\nYou review a vendor's CAPA (corrective and preventive action) for the IQC Head before they approve it or send it back. Rate each of the five elements: root cause (a real, specific, verified cause, not "operator mistake" or a restated symptom), containment (what was done with suspect stock at the vendor, in transit and at our plant), corrective action (removes the root cause, with owner and date), preventive action (stops recurrence in similar parts or processes), effectiveness evidence (data, trial results, photos, audit). Only the text fields are available; attached files are listed by name only, so say "see attached file" rather than assuming their content. Flag the CAPA as repetitive when it reuses the wording or substance of the vendor's earlier CAPAs for a similar problem.`,
    prompt: context,
  });
  // One entry per element, in order, even if the answer skipped one.
  output.elements = ELEMENTS.map((e) => output.elements.find((x) => x.element === e) ?? { element: e, rating: 'MISSING', finding: 'Not addressed.' });
  const saved = await store('CAPA_ASSESSMENT', capa.id, key, output, model, user.id);
  return { ...saved, cycleNo: capa.cycleNo };
}

// ── 11. Root cause and corrective action suggestions ──────────────────────────

const RootCauseSchema = z.object({
  causes: z.array(z.object({
    cause: z.string(),
    likelihood: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    reasoning: z.string().describe('why, from the data'),
    basedOn: z.array(z.string()).describe('DN or deviation numbers of similar past cases used, if any'),
  })).max(5),
  actions: z.array(z.object({
    action: z.string(),
    type: z.enum(['CONTAINMENT', 'CORRECTIVE', 'PREVENTIVE']),
    basedOn: z.array(z.string()),
  })).max(6),
  caution: z.string().describe('one sentence on how sure these are and what to verify'),
});

export async function rootCause(dnId, user, { refresh = false } = {}) {
  const dn = await dnService.detail(dnId, user);
  const db = getPool();
  // Similar past cases: DNs and deviations for the same item or vendor, with what was found and done.
  const { rows: pastDns } = await db.query(
    `SELECT n.dn_no, n.created_at, i.item_code, v.name AS vendor_name, n.defect,
            (SELECT string_agg(l.parameter || ': ' || coalesce(l.observation, ''), '; ') FROM qms.dn_defect_line l WHERE l.dn_id = n.id) AS lines,
            c.root_cause, c.corrective_action
       FROM qms.defect_notification n JOIN mst.item i ON i.id = n.item_id JOIN mst.vendor v ON v.id = n.vendor_id
       LEFT JOIN LATERAL (SELECT root_cause, corrective_action FROM qms.dn_capa WHERE dn_id = n.id ORDER BY (review_decision = 'APPROVED') DESC NULLS LAST, cycle_no DESC LIMIT 1) c ON true
      WHERE n.id <> $1 AND (n.item_id = $2 OR n.vendor_id = $3) ORDER BY (n.item_id = $2) DESC, n.created_at DESC LIMIT 15`,
    [dn.id, dn.itemId, dn.vendorId],
  );
  const { rows: pastDevs } = await db.query(
    `SELECT d.deviation_no, d.created_at, i.item_code, d.iqc_observation, d.correction, d.corrective_action, d.action, d.severity
       FROM qms.deviation d JOIN qms.imir m ON m.id = d.imir_id JOIN mst.item i ON i.id = m.item_id
      WHERE (m.item_id = $1 OR m.vendor_id = $2) AND d.imir_id IS DISTINCT FROM $3 AND d.iqc_observation IS NOT NULL
      ORDER BY (m.item_id = $1) DESC, d.created_at DESC LIMIT 10`,
    [dn.itemId, dn.vendorId, dn.imirId],
  );
  const context = [
    `Current DN ${dn.dnNo}: vendor ${dn.vendorName}, item ${dn.itemCode} ${dn.itemDescription}${dn.model ? `, model ${dn.model}` : ''}.`,
    `Defect: ${dn.defect ?? '—'}. Defective ${dn.defectiveQty ?? '—'} of ${dn.checkedQty ?? '—'} checked.`,
    ...dn.lines.map((l) => `- ${l.parameter}: spec ${l.specification ?? '—'}, observed ${l.observation ?? '—'}`),
    pastDns.length ? 'Past DNs for the same item or vendor (DN | date | item | vendor | defect | findings | root cause | action):' : 'No past DNs for this item or vendor.',
    ...camelRows(pastDns).map((p) => `- ${p.dnNo} | ${day(p.createdAt)} | ${p.itemCode} | ${p.vendorName} | ${p.defect ?? '—'} | ${p.lines ?? '—'} | ${p.rootCause ?? '—'} | ${p.correctiveAction ?? '—'}`),
    pastDevs.length ? 'Past deviations for the same item or vendor (deviation | date | item | observation | correction | corrective action):' : '',
    ...camelRows(pastDevs).map((p) => `- ${p.deviationNo} | ${day(p.createdAt)} | ${p.itemCode} | ${p.iqcObservation ?? '—'} | ${p.correction ?? '—'} | ${p.correctiveAction ?? '—'}`),
  ].filter(Boolean).join('\n');
  const key = hash(`${aiModel()}\n${context}`);
  if (!refresh) {
    const hit = await cached('ROOT_CAUSE', dn.id, key);
    if (hit) return hit;
  }
  const { output, model } = await askStructured({
    feature: 'ROOT_CAUSE', userId: user.id, schema: RootCauseSchema, maxTokens: 3000,
    system: `${BRIEF}\n${RULES}\nSuggest probable root causes and corrective actions for a defect, for quality staff to review and verify with the vendor. Rank causes by likelihood using the defect data and the similar past cases; name the past cases you relied on in basedOn. Typical cause areas: tool wear or setting, raw material, process parameters, handling and packing, measurement, design or drawing issues. Actions must be specific to this part and defect. These are suggestions, not findings.`,
    prompt: context,
  });
  return store('ROOT_CAUSE', dn.id, key, output, model, user.id);
}

// ── 7. Search in words ────────────────────────────────────────────────────────

const TARGETS = { imirs: 'incoming lots (IMIRs)', deviations: 'deviations', dns: 'defect notifications (DNs)' };
const fieldsText = Object.entries(LIST_FIELDS).map(([t, fields]) => `${t}: ${fields.map((f) => `${f.key} (${f.type}${f.options ? `: ${f.options.map((o) => o.value).join('|')}` : ''})`).join(', ')}`).join('\n');
const opsText = Object.entries(FILTER_OPERATORS).map(([type, ops]) => `${type}: ${ops.map((o) => o.op).join(', ')}`).join('\n');

const SearchSchema = z.object({
  target: z.enum(Object.keys(TARGETS)),
  mode: z.enum(['all', 'any']),
  rules: z.array(z.object({
    field: z.string(),
    op: z.string(),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])), z.null()]),
  })).max(8),
  explanation: z.string().describe('the search in plain words, e.g. "Not OK lots from vendors named ABC received in August 2026"'),
  unsupported: z.string().nullable().describe('what part of the question the filters cannot express, or null'),
});

/** Keeps only rules whose field, operator and value fit the list; says what was dropped. */
function checkRules(target, rules) {
  const fields = new Map(LIST_FIELDS[target].map((f) => [f.key, f]));
  const kept = [];
  const dropped = [];
  for (const r of rules) {
    const f = fields.get(r.field);
    const op = f && FILTER_OPERATORS[f.type].find((o) => o.op === r.op);
    let ok = Boolean(op);
    if (ok && op.range) ok = Array.isArray(r.value) && r.value.length === 2;
    if (ok && op.multi) ok = Array.isArray(r.value) && r.value.length > 0 && (!f.options || r.value.every((v) => f.options.some((o) => o.value === v)));
    if (ok && op.days) ok = Number.isInteger(Number(r.value)) && Number(r.value) > 0;
    if (ok && !op.noValue && !op.range && !op.multi && !op.days) ok = r.value !== null && r.value !== '' && !Array.isArray(r.value);
    if (ok) kept.push({ field: r.field, op: r.op, value: op.noValue ? null : op.days ? Number(r.value) : r.value });
    else dropped.push(`${r.field} ${r.op} ${JSON.stringify(r.value)}`);
  }
  return { kept, dropped };
}

export async function searchInWords(q, user) {
  const today = IST_DATE.format(new Date());
  const { output } = await askStructured({
    feature: 'NL_SEARCH', userId: user.id, schema: SearchSchema, maxTokens: 1500,
    system: `${BRIEF}\nTurn a question into filters for one of the QMAS lists. Today is ${today} (India). Lists and their fields (key (type: allowed values)):\n${fieldsText}\nOperators by field type:\n${opsText}\nValues: text as a string (use "contains" for names people type partially); dates as YYYY-MM-DD, "between" takes [from, to], "last_days" takes a number; enums take an array of the allowed values; bool takes true/false. "Failed", "rejected at inspection" or "not OK" lots mean result NOK. "Last month" means the whole previous calendar month. Choose the list the question is about (lots/inspections → imirs). Use mode "all" unless the question says "or".`,
    prompt: q,
  });
  const { kept, dropped } = checkRules(output.target, output.rules);
  return { target: output.target, filter: { mode: output.mode, rules: kept }, explanation: output.explanation, unsupported: output.unsupported, dropped };
}

// ── 8. Quality chatbot ────────────────────────────────────────────────────────

const LIST_QUERY = { imirs: imirListQuery, deviations: deviationListQuery, dns: dnListQuery };
const LIST_FN = { imirs: imirService.list, deviations: deviationService.list, dns: dnService.list };
const filterSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['all', 'any'] },
    rules: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string' }, value: {} }, required: ['field', 'op'] } },
  },
  required: ['rules'],
};
const TOOLS = [
  {
    name: 'find_records',
    description: `List lots (imirs), deviations or DNs matching filters, newest first, with the total count. Fields and operators:\n${fieldsText}\nOperators:\n${opsText}`,
    input_schema: {
      type: 'object',
      properties: { target: { type: 'string', enum: Object.keys(TARGETS) }, filter: filterSchema, limit: { type: 'integer', minimum: 1, maximum: 25 } },
      required: ['target'],
    },
  },
  {
    name: 'quality_stats',
    description: 'Lots inspected and Not-OK rate, grouped by vendor, item, plant, month or checkpoint, for a date range; optional vendor or item code. Use for trends, comparisons and "which vendor/item is worst".',
    input_schema: {
      type: 'object',
      properties: {
        groupBy: { type: 'string', enum: ['vendor', 'item', 'plant', 'month', 'checkpoint'] },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        vendorCode: { type: 'string' },
        itemCode: { type: 'string' },
      },
      required: ['groupBy'],
    },
  },
  {
    name: 'supplier_risk',
    description: 'Supplier risk ranking (score, level, recommended inspection level, reasons), open lots most likely to fail, and characteristics drifting in recent lots.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'lot_detail',
    description: 'One lot by IMIR number: facts, every checkpoint with readings and result, workflow steps and history alerts.',
    input_schema: { type: 'object', properties: { imirNo: { type: 'string' } }, required: ['imirNo'] },
  },
];

async function qualityStats(user, input) {
  const scope = plantScope(user, PERMISSIONS.IMIR_VIEW, 'view');
  const args = [];
  const where = ['m.result IS NOT NULL'];
  const arg = (v) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (!scope.all) where.push(`m.plant_id = ANY(${arg(scope.plantIds)})`);
  const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s ?? '') ? s : null);
  if (date(input.from)) where.push(`(m.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= ${arg(input.from)}`);
  if (date(input.to)) where.push(`(m.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= ${arg(input.to)}`);
  if (input.vendorCode) where.push(`v.vendor_code = ${arg(String(input.vendorCode).toUpperCase())}`);
  if (input.itemCode) where.push(`i.item_code = ${arg(String(input.itemCode).toUpperCase())}`);
  const from = 'FROM qms.imir m JOIN mst.vendor v ON v.id = m.vendor_id JOIN mst.item i ON i.id = m.item_id JOIN core.plant p ON p.id = m.plant_id';
  if (input.groupBy === 'checkpoint') {
    const { rows } = await getPool().query(
      `SELECT i.item_code, fc.checkpoint, count(*)::int AS lots, count(*) FILTER (WHERE c.result = 'NOK')::int AS nok
         ${from} JOIN qms.imir_checkpoint c ON c.imir_id = m.id
         JOIN qms.format_checkpoint fc ON fc.version_id = m.format_version_id AND fc.checkpoint_uid = c.checkpoint_uid
        WHERE ${where.join(' AND ')} GROUP BY 1, 2 HAVING count(*) FILTER (WHERE c.result = 'NOK') > 0 ORDER BY nok DESC LIMIT 30`,
      args,
    );
    return camelRows(rows);
  }
  const key = { vendor: "v.vendor_code || ' ' || v.name", item: "i.item_code || ' ' || i.description", plant: "p.sap_code || ' ' || p.name", month: "to_char(m.submitted_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')" }[input.groupBy];
  if (!key) throw AppError.badRequest('Unknown grouping.');
  const { rows } = await getPool().query(
    `SELECT ${key} AS "group", count(*)::int AS lots, count(*) FILTER (WHERE m.result = 'NOK')::int AS nok,
            round(100.0 * count(*) FILTER (WHERE m.result = 'NOK') / count(*), 1)::float AS nok_pct
       ${from} WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY ${input.groupBy === 'month' ? '1' : 'nok DESC, lots DESC'} LIMIT 40`,
    args,
  );
  return camelRows(rows);
}

async function runChatTool(user, name, input) {
  if (name === 'find_records') {
    const target = TARGETS[input.target] ? input.target : 'imirs';
    const { kept, dropped } = checkRules(target, input.filter?.rules ?? []);
    const q = LIST_QUERY[target].parse({ pageSize: Math.min(Number(input.limit) || 10, 25), sort: 'createdAt', order: 'desc', filter: JSON.stringify({ mode: input.filter?.mode ?? 'all', rules: kept }) });
    const { data, meta } = await LIST_FN[target](user, q);
    const pick = (r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== null && !/id$|Id$|rowVersion|Version/.test(k) && typeof v !== 'object'));
    return { total: meta.total, shown: data.length, rows: data.map(pick), ignoredFilters: dropped };
  }
  if (name === 'quality_stats') return qualityStats(user, input);
  if (name === 'supplier_risk') {
    const o = await overview(user);
    return {
      vendors: o.vendors.slice(0, 15).map((v) => ({ vendor: `${v.vendorCode} ${v.vendorName}`, score: v.score, level: v.level, recommendation: v.recommendation, lots: v.lots, nok: v.nok, reasons: v.reasons })),
      openLotsMostLikelyToFail: o.openLots.slice(0, 10).map((l) => ({ imirNo: l.imirNo, item: l.itemCode, vendor: l.vendorName, probability: l.probability })),
      drift: o.drift.slice(0, 10).map((d) => ({ item: d.itemCode, vendor: d.vendorName, checkpoint: d.checkpoint, status: d.status, message: d.message, imirNo: d.imirNo })),
    };
  }
  if (name === 'lot_detail') {
    const { rows } = await getPool().query('SELECT id FROM qms.imir WHERE imir_no = $1', [String(input.imirNo ?? '').trim().toUpperCase()]);
    if (!rows[0]) throw AppError.notFound(`IMIR ${input.imirNo}`);
    const m = await imirService.detail(rows[0].id, user);
    return { text: lotContext(m, await lotInsights(rows[0].id, user).catch(() => null)) };
  }
  throw AppError.badRequest(`Unknown tool ${name}.`);
}

/** One chatbot turn. history = [{ role: 'user' | 'assistant', content: text }], last one the user's. */
export async function chat(history, user) {
  const today = IST_DATE.format(new Date());
  const { text, toolCalls } = await chatWithTools({
    feature: 'CHAT', userId: user.id, maxTokens: 3000, tools: TOOLS,
    system: `${BRIEF}\n${RULES}\nYou are "Ask QMAS", answering questions about inspection, deviation and DN data with the tools. Today is ${today} (India). The tools only return data this user may see. Look data up before answering; for comparisons and trends use quality_stats. Answer briefly: the answer first, then the supporting figures (a short Markdown table when comparing), and name IMIR, deviation or DN numbers so they can be opened. Percentages with one decimal. If the data cannot answer the question, say what is missing.`,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    runTool: (name, input) => runChatTool(user, name, input),
  });
  return { reply: text, toolCalls: toolCalls.map((t) => t.name) };
}

// ── 5. Spoken observation → inspection text ───────────────────────────────────

const TidySchema = z.object({
  text: z.string().describe('the observation as clean inspection text'),
  values: z.array(z.number()).describe('numeric readings mentioned, in order; empty if none'),
});

export async function tidyObservation({ text, checkpoint, specification, unit }, user) {
  const { output } = await askStructured({
    feature: 'VOICE_TIDY', userId: user.id, schema: TidySchema, maxTokens: 800,
    system: `${BRIEF}\nAn inspector dictated an observation; speech recognition wrote it down. Turn it into short, clear inspection text: fix recognition errors from context, write numbers as digits with units ("ten point two mm" → "10.2 mm"), keep every fact and add none. If a checkpoint is given, keep the wording relevant to it.`,
    prompt: `Checkpoint: ${checkpoint ?? '—'}${specification ? `, specification ${specification}` : ''}${unit ? `, unit ${unit}` : ''}\nDictated: ${text}`,
  });
  return output;
}
