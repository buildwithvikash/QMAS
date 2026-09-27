import { randomUUID } from 'node:crypto';
import { checkpointSchema, diffVersions, FIELD_LABELS, isEmptyDiff, mergeVersions, PERMISSIONS, renumber, submitProblems } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { lookupSan } from '../../integrations/san/index.js';
import { openAwaitingForItem } from '../imir/imir.service.js';
import { issuesToErrors } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, pageMeta } from '../../shared/sql.js';
import * as repo from './formats.repo.js';

const EDITABLE = ['DRAFT', 'REJECTED'];
const OPEN = ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'CONFLICT'];
const EMPTY = { header: { formatNo: null, commonFormatNo: null, refStandard: null }, checkpoints: [] };
const DEFAULT_REF_STANDARD = 'IS 2500';

const canApprove = (user) => user.permissions.has(PERMISSIONS.FORMATS_APPROVE);
const isOwner = (user, v) => v.createdBy === user.id;

async function mustGetVersion(db, id, opts) {
  const v = await repo.getVersion(db, id, opts);
  if (!v) throw AppError.notFound('Format version');
  return v;
}

/** What the current user may do with a version; the UI shows exactly these actions. */
function allowedActions(user, v) {
  const actions = [];
  if (isOwner(user, v) && EDITABLE.includes(v.status)) actions.push('edit', 'submit');
  if (isOwner(user, v) && OPEN.includes(v.status)) actions.push('discard');
  if (canApprove(user) && v.status === 'PENDING_APPROVAL') actions.push('approve', 'reject');
  if (canApprove(user) && v.status === 'CONFLICT') actions.push('reject');
  if ((isOwner(user, v) || canApprove(user)) && v.status === 'CONFLICT') actions.push('resolve');
  return actions;
}

// ── History ───────────────────────────────────────────────────────────────────

const brief = (c) => ({ uid: c.uid, section: c.section, groupLabel: c.groupLabel ?? null, inputType: c.inputType ?? null, checkpoint: c.checkpoint });

/** A diff small enough to keep with a history step: what was added, removed and changed (field by field). */
export function compactDiff(d) {
  return {
    header: d.header,
    added: d.added.map(brief),
    removed: d.removed.map(brief),
    changed: d.changed.map((c) => ({ uid: c.uid, checkpoint: c.checkpoint, fields: c.fields })),
    moved: d.moved?.length ?? 0,
  };
}

/** Steps on an item's format (all versions), newest first. */
export async function itemHistory(itemId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT id FROM qms.format WHERE item_id = $1', [itemId]);
  if (!rows[0]) return [];
  return repo.events(pool, { formatId: rows[0].id });
}

/** Steps on one version (its draft life and approval), newest first. */
export async function versionHistory(id) {
  const pool = getPool();
  const v = await mustGetVersion(pool, id);
  return repo.events(pool, { formatId: v.formatId, versionId: id });
}

export const libraryCounts = () => repo.libraryCounts(getPool());

// ── Reading ───────────────────────────────────────────────────────────────────

export async function library(filters) {
  const { rows, total } = await repo.library(getPool(), filters);
  return { data: rows, meta: pageMeta(filters, total) };
}

export const approvalQueue = () => repo.queue(getPool());

export async function itemFormat(itemId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT i.id, i.item_code, i.description, i.drawing_no, i.drawing_rev, i.is_active, c.name AS category_name, u.code AS uom_code
       FROM mst.item i LEFT JOIN mst.item_category c ON c.id = i.category_id LEFT JOIN mst.uom u ON u.id = i.uom_id WHERE i.id = $1`,
    [itemId],
  );
  const item = camelRow(rows[0]);
  if (!item) throw AppError.notFound('Item');
  // Lots of this item: all received, waiting for a format, and inspected against the current version.
  const { rows: st } = await pool.query(
    `SELECT count(*)::int AS lots_total, count(*) FILTER (WHERE m.status = 'AWAITING_FORMAT')::int AS lots_waiting,
            count(*) FILTER (WHERE m.format_version_id = f.current_version_id)::int AS lots_on_current, max(m.created_at) AS last_lot_at
       FROM qms.imir m LEFT JOIN qms.format f ON f.item_id = m.item_id WHERE m.item_id = $1`,
    [itemId],
  );
  const stats = camelRow(st[0]);
  const { rows: f } = await pool.query('SELECT id, current_version_id FROM qms.format WHERE item_id = $1', [itemId]);
  const format = camelRow(f[0]) ?? null;
  if (!format) return { item, format: null, current: null, versions: [], stats };
  const current = format.currentVersionId ? await getVersion(format.currentVersionId, null) : null;
  return { item, format, current, versions: await repo.versionsOf(pool, format.id), stats };
}

export async function getVersion(id, user) {
  const pool = getPool();
  const v = await mustGetVersion(pool, id);
  const checkpoints = await repo.getCheckpoints(pool, id);
  const result = { ...v, checkpoints };
  if (v.status === 'CONFLICT') {
    result.conflicts = await repo.openConflicts(pool, id);
    // For the conflicts page: the version it clashes with, and how many changes merge by themselves.
    const against = await repo.getVersion(pool, v.currentVersionId);
    const [base, theirs, mine] = [await repo.loadModel(pool, v.baseVersionId), await repo.loadModel(pool, against), await repo.loadModel(pool, v)];
    const d = diffVersions(theirs, mergeVersions(base, theirs, mine).merged);
    result.mergeInfo = {
      against: { id: against.id, versionNo: against.versionNo, decidedAt: against.decidedAt, decidedByName: against.decidedByName },
      autoResolved: d.header.length + d.added.length + d.removed.length + d.changed.reduce((n, c) => n + c.fields.length, 0),
    };
  }
  if (user) {
    result.allowedActions = allowedActions(user, v);
    result.otherOpenDrafts = await repo.openDraftsOf(pool, v.formatId, v.id);
    result.behindCurrent = OPEN.includes(v.status) && v.baseVersionId !== v.currentVersionId;
  }
  return result;
}

export async function compare(aId, bId) {
  const pool = getPool();
  const [a, b] = await Promise.all([mustGetVersion(pool, aId), mustGetVersion(pool, bId)]);
  const diff = diffVersions(await repo.loadModel(pool, a), await repo.loadModel(pool, b));
  return { a: { id: a.id, versionNo: a.versionNo, status: a.status, itemCode: a.itemCode }, b: { id: b.id, versionNo: b.versionNo, status: b.status, itemCode: b.itemCode }, diff };
}

// ── Drafts ────────────────────────────────────────────────────────────────────

const withNewUids = (checkpoints) => checkpoints.map((c) => ({ ...c, uid: randomUUID() }));

/**
 * Starts a draft (a branch) for an item. Its base is the approved version at this moment, so
 * approval later knows whether to fast-forward or merge. Other open drafts are allowed and
 * reported, as Git allows several branches.
 */
export async function createDraft(ctx, user, itemId, { from, vendorCode, cloneFromVersionId }) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT id, item_code, is_active FROM mst.item WHERE id = $1', [itemId]);
  const item = rows[0];
  if (!item) throw AppError.notFound('Item');
  if (!item.is_active) throw AppError.unprocessable('This item is inactive. Activate it in Master Config → Items first.');

  // SAN/SIR is called outside the transaction: it is a remote system.
  let san;
  if (from === 'SAN') {
    san = await lookupSan({ vendorCode, itemCode: item.item_code }, { userId: user.id });
    if (!san.found) {
      throw AppError.unprocessable(`SAN/SIR has no data for vendor ${vendorCode} and item ${item.item_code}. Create the format as new instead.`, [{ path: 'vendorCode', message: 'No SAN/SIR record for this vendor and item.' }]);
    }
  }

  return withTransaction(ctx, async (db) => {
    const format = await repo.ensureFormat(db, itemId, user.id);
    const current = format.currentVersionId ? await repo.loadModel(db, format.currentVersionId) : null;
    let header = { ...(current?.header ?? { refStandard: DEFAULT_REF_STANDARD }) };
    let checkpoints = [];
    let source;
    let sourceRef = null;

    if (from === 'CURRENT') {
      if (!current) throw AppError.unprocessable('This item has no approved format yet. Start from SAN/SIR, a copy, or a blank format.');
      checkpoints = current.checkpoints; // same uids: edits merge cleanly later
      source = 'CURRENT';
    } else if (from === 'BLANK' || from === 'CUSTOM') {
      // CUSTOM: built from scratch in the format builder (own sections and field types).
      source = from === 'CUSTOM' ? 'CUSTOM' : 'NEW';
    } else if (from === 'SAN') {
      checkpoints = withNewUids(san.checkpoints);
      source = 'SAN';
      sourceRef = { vendorCode, reference: san.reference };
    } else {
      const src = await mustGetVersion(db, cloneFromVersionId);
      if (!['APPROVED', 'SUPERSEDED'].includes(src.status)) throw AppError.unprocessable('Only approved formats (current or earlier versions) can be copied.');
      const model = await repo.loadModel(db, src);
      // Copying an older version of the same item keeps checkpoint identities (a revert);
      // another item's format gets fresh ones.
      checkpoints = src.formatId === format.id ? model.checkpoints : withNewUids(model.checkpoints);
      header = src.formatId === format.id ? model.header : { ...header, refStandard: model.header.refStandard };
      source = 'CLONE';
      sourceRef = { versionId: src.id, itemCode: src.itemCode, versionNo: src.versionNo };
    }

    const id = await repo.insertVersion(db, { formatId: format.id, status: 'DRAFT', source, sourceRef, baseVersionId: format.currentVersionId, header, userId: user.id });
    await repo.replaceCheckpoints(db, id, renumber(checkpoints));
    const baseVersionNo = format.currentVersionId ? (await repo.getVersion(db, format.currentVersionId)).versionNo : null;
    await repo.addEvent(db, { formatId: format.id, versionId: id, action: 'CREATED', userId: user.id, detail: { source, sourceRef, baseVersionNo, checkpoints: checkpoints.length } });
    return id;
  }).then((id) => getVersion(id, user));
}

/** Saves the whole draft. A rejected draft becomes a draft again when edited. */
export async function saveDraft(ctx, user, id, body) {
  await withTransaction(ctx, async (db) => {
    const v = await mustGetVersion(db, id, { forUpdate: true });
    if (!isOwner(user, v)) throw AppError.forbidden('Only the person who started this draft can edit it.');
    if (!EDITABLE.includes(v.status)) throw AppError.conflict(`This version is ${v.status.toLowerCase().replace('_', ' ')} and can no longer be edited.`);
    const checkpoints = renumber(body.checkpoints.map((c) => ({ ...c, uid: c.uid ?? randomUUID() })));
    const before = await repo.loadModel(db, v);
    const ok = await repo.updateVersion(db, id, body.rowVersion, {
      status: 'DRAFT',
      formatNo: body.formatNo ?? null,
      commonFormatNo: body.commonFormatNo ?? null,
      refStandard: body.refStandard ?? null,
      remarks: body.remarks ?? null,
    });
    if (!ok) throw AppError.staleVersion('This draft');
    await repo.replaceCheckpoints(db, id, checkpoints);
    // History keeps what this save changed; a save without changes leaves no entry.
    const d = diffVersions(before, await repo.loadModel(db, id));
    if (!isEmptyDiff(d) || d.moved.length) {
      await repo.addEvent(db, { formatId: v.formatId, versionId: id, action: 'SAVED', userId: user.id, detail: compactDiff(d) });
    }
  });
  return getVersion(id, user);
}

// ── Workflow actions ──────────────────────────────────────────────────────────

export async function act(ctx, user, id, { action, remark, rowVersion, mode }) {
  const handlers = { submit, discard, reject, approve };
  const outcome = await withTransaction(ctx, (db) => handlers[action](db, user, id, { remark, rowVersion, mode }));
  return { outcome, version: await getVersion(id, user) };
}

async function submit(db, user, id, { rowVersion }) {
  const v = await mustGetVersion(db, id, { forUpdate: true });
  if (!isOwner(user, v)) throw AppError.forbidden('Only the person who started this draft can submit it.');
  if (!EDITABLE.includes(v.status)) throw AppError.conflict('Only drafts can be submitted.');
  const model = await repo.loadModel(db, v);
  const problems = submitProblems(model);
  // Content saved before a rule changed is re-checked here.
  model.checkpoints.forEach((c, i) => {
    const r = checkpointSchema.safeParse(c);
    if (!r.success) problems.push(...issuesToErrors(r.error.issues).map((e) => `Checkpoint ${i + 1} (${c.checkpoint}): ${e.message}`));
  });
  if (problems.length) throw AppError.unprocessable(problems[0], problems.map((message) => ({ path: 'checkpoints', message })));
  if (!(await repo.updateVersion(db, id, rowVersion, { status: 'PENDING_APPROVAL', submittedAt: new Date(), submittedBy: user.id }))) {
    throw AppError.staleVersion('This draft');
  }
  await repo.addEvent(db, { formatId: v.formatId, versionId: id, action: 'SUBMITTED', userId: user.id, detail: { checkpoints: model.checkpoints.length } });
  return 'SUBMITTED';
}

async function discard(db, user, id, { rowVersion }) {
  const v = await mustGetVersion(db, id, { forUpdate: true });
  if (!isOwner(user, v)) throw AppError.forbidden('Only the person who started this draft can discard it.');
  if (!OPEN.includes(v.status)) throw AppError.conflict('This version is already closed.');
  if (!(await repo.updateVersion(db, id, rowVersion, { status: 'DISCARDED' }))) throw AppError.staleVersion('This draft');
  await repo.addEvent(db, { formatId: v.formatId, versionId: id, action: 'DISCARDED', userId: user.id });
  return 'DISCARDED';
}

async function reject(db, user, id, { remark, rowVersion }) {
  if (!canApprove(user)) throw AppError.forbidden();
  const v = await mustGetVersion(db, id, { forUpdate: true });
  if (!['PENDING_APPROVAL', 'CONFLICT'].includes(v.status)) throw AppError.conflict('Only submitted formats can be rejected.');
  if (!(await repo.updateVersion(db, id, rowVersion, { status: 'REJECTED', decidedAt: new Date(), decidedBy: user.id, decisionRemark: remark }))) {
    throw AppError.staleVersion('This format');
  }
  await repo.addEvent(db, { formatId: v.formatId, versionId: id, action: 'RETURNED', userId: user.id, remark });
  return 'REJECTED';
}

/** Makes the draft the approved version; the previous approved version becomes superseded. */
async function fastForward(db, user, v, format, { remark, mergeNote = null, merged = false }) {
  const previous = format.currentVersionId ? await repo.loadModel(db, format.currentVersionId) : EMPTY;
  if (format.currentVersionId) await repo.updateVersion(db, format.currentVersionId, null, { status: 'SUPERSEDED' });
  const versionNo = await repo.nextVersionNo(db, v.formatId);
  await repo.updateVersion(db, v.id, null, {
    status: 'APPROVED', versionNo, baseVersionId: format.currentVersionId, decidedAt: new Date(), decidedBy: user.id,
    decisionRemark: remark ?? null, mergeNote,
  });
  await repo.setCurrent(db, v.formatId, v.id);
  // History: what this approval changed against the version it replaces.
  const changes = compactDiff(diffVersions(previous, await repo.loadModel(db, v.id)));
  await repo.addEvent(db, {
    formatId: v.formatId, versionId: v.id, action: merged ? 'MERGED' : 'APPROVED', userId: user.id, remark: remark ?? null,
    detail: { versionNo, note: mergeNote, changes },
  });
  // Inward lots that were waiting for this item's format open now (number, sample, format pinned).
  await openAwaitingForItem(db, v.itemId, { userId: user.id });
  return versionNo;
}

/**
 * Approval (Git semantics):
 *  - base is still the approved version        → fast-forward;
 *  - approved version moved on since the base  → three-way merge; clean merges are applied,
 *    clashes put the draft in CONFLICT for someone to resolve;
 *  - draft started before any format existed, and one was approved since ("unrelated histories")
 *    → only with mode REPLACE, which takes the draft as the new version without merging.
 */
async function approve(db, user, id, { remark, rowVersion, mode }) {
  if (!canApprove(user)) throw AppError.forbidden();
  const v = await mustGetVersion(db, id, { forUpdate: true });
  if (v.status === 'CONFLICT') throw AppError.conflict('Resolve the merge conflicts before approving.', { code: 'MERGE_CONFLICT' });
  if (v.status !== 'PENDING_APPROVAL') throw AppError.conflict('Only submitted formats can be approved.');
  if (v.rowVersion !== rowVersion) throw AppError.staleVersion('This format');
  const format = await repo.lockFormat(db, v.formatId);

  if (v.baseVersionId === format.currentVersionId) {
    const n = await fastForward(db, user, v, format, { remark });
    return { result: 'APPROVED', versionNo: n };
  }

  const current = await repo.getVersion(db, format.currentVersionId);
  if (!v.baseVersionId) {
    if (mode !== 'REPLACE') {
      throw AppError.conflict(
        `This draft was started before any format existed, and v${current.versionNo} has been approved since. Approve it as a replacement of v${current.versionNo}, or reject it.`,
        { code: 'UNRELATED_DRAFT' },
      );
    }
    const n = await fastForward(db, user, v, format, { remark, mergeNote: `Replaced v${current.versionNo} without merging.` });
    return { result: 'APPROVED', versionNo: n };
  }

  // One transaction client runs one query at a time, so these are sequential.
  const base = await repo.loadModel(db, v.baseVersionId);
  const theirs = await repo.loadModel(db, current);
  const mine = await repo.loadModel(db, v);
  const { merged, conflicts } = mergeVersions(base, theirs, mine);
  if (conflicts.length) {
    await repo.replaceOpenConflicts(db, v.id, current.id, conflicts);
    await repo.updateVersion(db, v.id, null, { status: 'CONFLICT' });
    await repo.addEvent(db, {
      formatId: v.formatId, versionId: v.id, action: 'CONFLICT', userId: user.id,
      detail: { conflicts: conflicts.length, againstVersionNo: current.versionNo, fields: conflicts.map((c) => ({ checkpoint: c.checkpoint, field: c.field })) },
    });
    return { result: 'CONFLICT', conflicts: conflicts.length, againstVersionNo: current.versionNo };
  }
  await applyMerged(db, v.id, merged);
  const n = await fastForward(db, user, v, format, { remark, merged: true, mergeNote: `Merged with v${current.versionNo} (started from v${v.baseVersionNo}).` });
  return { result: 'APPROVED', versionNo: n, merged: true };
}

async function applyMerged(db, versionId, merged, extra = {}) {
  await repo.replaceCheckpoints(db, versionId, merged.checkpoints);
  await repo.updateVersion(db, versionId, null, { formatNo: merged.header.formatNo, commonFormatNo: merged.header.commonFormatNo, refStandard: merged.header.refStandard, ...extra });
}

/** Shows what approval would do, without changing anything. */
export async function mergePreview(id) {
  const pool = getPool();
  const v = await mustGetVersion(pool, id);
  const mine = await repo.loadModel(pool, v);
  if (v.baseVersionId === v.currentVersionId) {
    const base = v.baseVersionId ? await repo.loadModel(pool, v.baseVersionId) : EMPTY;
    return { mode: 'FAST_FORWARD', againstVersionNo: v.baseVersionNo, changes: diffVersions(base, mine), conflicts: [] };
  }
  const current = await repo.getVersion(pool, v.currentVersionId);
  if (!v.baseVersionId) return { mode: 'UNRELATED', againstVersionNo: current.versionNo, changes: diffVersions(await repo.loadModel(pool, current), mine), conflicts: [] };
  const [base, theirs] = await Promise.all([repo.loadModel(pool, v.baseVersionId), repo.loadModel(pool, current)]);
  const { merged, conflicts } = mergeVersions(base, theirs, mine);
  return { mode: 'MERGE', againstVersionNo: current.versionNo, baseVersionNo: v.baseVersionNo, changes: diffVersions(theirs, merged), conflicts };
}

// ── Conflict resolution ───────────────────────────────────────────────────────

function resolutionValue(conflict, { choice, value }) {
  if (choice === 'THEIRS') return conflict.theirsValue;
  if (choice === 'MINE') return conflict.mineValue;
  if (conflict.field === '_presence') {
    if (typeof value !== 'boolean') throw AppError.unprocessable('Choose whether to keep the checkpoint.');
    return value;
  }
  if (value === undefined) throw AppError.unprocessable(`Enter a value for ${FIELD_LABELS[conflict.field] ?? conflict.field}.`);
  return value === '' ? null : value;
}

/**
 * Applies a choice for every open conflict, rebases the draft onto the approved version it was
 * compared with, and puts it back in the approval queue (keeping its original submission time).
 * If yet another version was approved meanwhile, the merge is recomputed and new conflicts shown.
 */
export async function resolveConflicts(ctx, user, id, { resolutions, rowVersion }) {
  const outcome = await withTransaction(ctx, async (db) => {
    const v = await mustGetVersion(db, id, { forUpdate: true });
    if (!isOwner(user, v) && !canApprove(user)) throw AppError.forbidden('Only the draft owner or an approver can resolve conflicts.');
    if (v.status !== 'CONFLICT') throw AppError.conflict('This format has no open conflicts.');
    if (v.rowVersion !== rowVersion) throw AppError.staleVersion('This format');
    const format = await repo.lockFormat(db, v.formatId);
    const open = await repo.openConflicts(db, id);
    const base = await repo.loadModel(db, v.baseVersionId);
    const theirs = await repo.loadModel(db, format.currentVersionId);
    const mine = await repo.loadModel(db, v);

    if (open[0]?.againstVersionId !== format.currentVersionId) {
      const again = mergeVersions(base, theirs, mine);
      await repo.replaceOpenConflicts(db, id, format.currentVersionId, again.conflicts);
      await repo.updateVersion(db, id, null, { status: 'CONFLICT' });
      await repo.addEvent(db, { formatId: v.formatId, versionId: id, action: 'CONFLICT', userId: user.id, detail: { conflicts: again.conflicts.length, recomputed: true } });
      return { result: 'RECOMPUTED', conflicts: again.conflicts.length };
    }

    const byId = new Map(resolutions.map((r) => [r.conflictId, r]));
    const missing = open.filter((c) => !byId.has(Number(c.id)));
    if (missing.length) throw AppError.unprocessable(`Choose a value for all ${open.length} conflicts (${missing.length} left).`);

    const map = {};
    const chosen = open.map((c) => {
      const r = byId.get(Number(c.id));
      const value = resolutionValue(c, r);
      map[`${c.checkpointUid ?? ''}|${c.field}`] = value;
      return { c, r, value };
    });
    const { merged, conflicts } = mergeVersions(base, theirs, mine, map);
    if (conflicts.length) throw new Error('merge still has conflicts after resolution');
    const errors = [];
    merged.checkpoints.forEach((cp) => {
      const r = checkpointSchema.safeParse(cp);
      if (!r.success) errors.push(...issuesToErrors(r.error.issues).map((e) => ({ path: 'resolutions', message: `${cp.checkpoint}: ${e.message}` })));
    });
    if (errors.length) throw AppError.unprocessable(errors[0].message, errors);

    for (const { c, r, value } of chosen) await repo.markResolved(db, c.id, r.choice, value, user.id);
    await applyMerged(db, id, merged, {
      status: 'PENDING_APPROVAL',
      baseVersionId: format.currentVersionId,
      mergeNote: `Conflicts with v${(await repo.getVersion(db, format.currentVersionId)).versionNo} resolved by ${user.fullName}.`,
    });
    await repo.addEvent(db, {
      formatId: v.formatId, versionId: id, action: 'RESOLVED', userId: user.id,
      detail: { choices: chosen.map(({ c, r, value }) => ({ checkpoint: c.label, field: c.field, choice: r.choice, value, remark: r.remark ?? null })) },
    });
    return { result: 'RESOLVED' };
  });
  return { outcome, version: await getVersion(id, user) };
}
