import { BUSINESS_TIME_ZONE } from '@qmas/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { adminAgent, plantId, uid } from './helpers.js';
import { approveFormat, inspector, inwardLot, ok, submittedLot } from './lots.js';

// The same figures appear on Home, Incoming Lots and Reports. Each is checked against a direct count
// of qms.imir, and against the others where they describe the same lots.
const CLOSED = ['CLOSED_ACCEPTED', 'CLOSED_REJECTED', 'CLOSED_UNDER_DEVIATION', 'AUTO_CLOSED'];
const IN_REVIEW = ['SUBMITTED', 'WITH_IQC_HEAD', 'DEPT_REVIEW', 'IQC_HEAD_FINAL', 'SENIOR_ESCALATION', 'UNDER_DEVIATION', 'QTY_VERIFICATION'];
const q = async (sql, args = []) => (await getPool().query(sql, args)).rows;
const statusFilter = (...s) => encodeURIComponent(JSON.stringify({ mode: 'all', rules: [{ field: 'status', op: 'in', value: s }] }));

let admin;
let insp; // IQC Inspector of plant 1115
beforeAll(async () => {
  admin = (await adminAgent()).agent;
  insp = (await inspector('1115')).agent;
  // Lots in several states at two plants: OK and Not OK submitted, open, and waiting for a format.
  await submittedLot(insp, { pass: true });
  await submittedLot(insp);
  const open = uid('OPN');
  await approveFormat(open);
  await inwardLot({ itemCode: open, plant: '1115' });
  await inwardLot({ itemCode: open, plant: '1111' });
  await inwardLot({ itemCode: uid('NOF'), plant: '1111' });
});

describe('Home, Incoming Lots and the database agree', () => {
  it('open lots by status: dashboard = database', async () => {
    const s = ok(await admin.get('/api/v1/dashboard/summary'));
    const truth = Object.fromEntries((await q('SELECT status, count(*)::int AS n FROM qms.imir WHERE status <> ALL($1) GROUP BY status', [CLOSED])).map((r) => [r.status, r.n]));
    expect(s.imirByStatus).toEqual(truth);
  });

  it('list cards and list totals = database, and = the Home tiles that link to them', async () => {
    const c = ok(await admin.get('/api/v1/imirs/counts'));
    const [t] = await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'AWAITING_FORMAT')::int AS awaiting,
                                count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'IN_INSPECTION')::int AS inspecting,
                                count(*) FILTER (WHERE status = ANY($1))::int AS review, count(*) FILTER (WHERE status = ANY($2))::int AS closed,
                                count(*) FILTER (WHERE result = 'NOK')::int AS nok FROM qms.imir`, [IN_REVIEW, CLOSED]);
    expect(c).toMatchObject({ total: t.total, awaitingFormat: t.awaiting, toInspect: t.open, inspecting: t.inspecting, inReview: t.review, closed: t.closed, nok: t.nok });
    expect(c.awaitingFormat + c.toInspect + c.inspecting + c.inReview + c.closed).toBe(c.total);

    const list = await admin.get('/api/v1/imirs?page=1&pageSize=1');
    expect(list.body.meta.total).toBe(t.total);
    // Home "To Inspect" and "In Review" open these filtered lists: same numbers.
    const s = ok(await admin.get('/api/v1/dashboard/summary'));
    const st = s.imirByStatus;
    const toInspect = await admin.get(`/api/v1/imirs?page=1&pageSize=1&filter=${statusFilter('OPEN', 'IN_INSPECTION')}`);
    expect(toInspect.body.meta.total).toBe((st.OPEN ?? 0) + (st.IN_INSPECTION ?? 0));
    const review = await admin.get(`/api/v1/imirs?page=1&pageSize=1&filter=${statusFilter('SUBMITTED', 'WITH_IQC_HEAD')}`);
    expect(review.body.meta.total).toBe((st.SUBMITTED ?? 0) + (st.WITH_IQC_HEAD ?? 0));
  });

  it('the 30-day trend adds up to the 30-day lots box, and both = database (IST days)', async () => {
    const s = ok(await admin.get('/api/v1/dashboard/summary?trendDays=30&glanceDays=30'));
    expect(s.trend).toHaveLength(30);
    const sum = (k) => s.trend.reduce((a, d) => a + d[k], 0);
    expect(sum('received')).toBe(s.lots30Days.received);
    expect(sum('ok')).toBe(s.lots30Days.ok);
    expect(sum('nok')).toBe(s.lots30Days.nok);
    const [t] = await q(`SELECT count(*)::int AS n FROM qms.imir
                          WHERE (created_at AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date >= (now() AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date - 29`);
    expect(s.lots30Days.received).toBe(t.n);

    // Each bar is an IST day, and clicking it ("Received on <day>") lists exactly its lots.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(new Date());
    expect(s.trend.at(-1).day).toBe(today);
    for (const bar of s.trend.filter((d) => d.received > 0)) {
      const f = encodeURIComponent(JSON.stringify({ mode: 'all', rules: [{ field: 'receivedAt', op: 'on', value: bar.day }] }));
      const list = await admin.get(`/api/v1/imirs?page=1&pageSize=1&filter=${f}`);
      expect(list.body.meta.total).toBe(bar.received);
    }
  });

  it('calendar dates (GRN date) come back as the same day, not shifted by the time zone', async () => {
    const [r] = await q("SELECT id, grn_date::text AS d FROM qms.imir ORDER BY created_at DESC LIMIT 1");
    const m = ok(await admin.get(`/api/v1/imirs/${r.id}`));
    expect(m.grnDate).toBe(r.d);
  });

  it('a change shows on Home at once (the dashboard cache is emptied by writes)', async () => {
    const before = ok(await admin.get('/api/v1/dashboard/summary')).imirByStatus.SUBMITTED ?? 0;
    await submittedLot(insp, { pass: true });
    const after = ok(await admin.get('/api/v1/dashboard/summary')).imirByStatus.SUBMITTED ?? 0;
    expect(after).toBe(before + 1);
  });

  it('a plant user sees only their plant, consistently on Home and in the list', async () => {
    const p = await plantId('1115');
    const s = ok(await insp.get('/api/v1/dashboard/summary'));
    const truth = Object.fromEntries((await q('SELECT status, count(*)::int AS n FROM qms.imir WHERE plant_id = $1 AND status <> ALL($2) GROUP BY status', [p, CLOSED])).map((r) => [r.status, r.n]));
    expect(s.imirByStatus).toEqual(truth);
    const c = ok(await insp.get('/api/v1/imirs/counts'));
    expect(c.toInspect).toBe(truth.OPEN ?? 0);
    // Their inspection tasks: every open lot of their plant (none of another plant), except lots
    // another inspector is working on right now.
    const tasks = ok(await insp.get('/api/v1/tasks/me')).filter((x) => x.kind === 'inspect');
    const me = ok(await insp.get('/api/v1/auth/me')).user;
    const [o] = await q(`SELECT count(*)::int AS n FROM qms.imir WHERE plant_id = $1 AND status IN ('OPEN', 'IN_INSPECTION')
                           AND (claimed_by IS NULL OR claimed_by = $2 OR claimed_at < now() - interval '30 minutes')`, [p, me.id]);
    expect(tasks.length).toBe(Math.min(o.n, 1000));
    expect(tasks.every((x) => x.plantSapCode === '1115')).toBe(true);
  });
});

describe('Reports agree with the database and with each other', () => {
  it('lot register, vendor quality and item quality count the same lots', async () => {
    const reg = ok(await admin.get('/api/v1/reports/imir-register'));
    const [t] = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE result = 'NOK')::int AS nok, coalesce(sum(inward_qty), 0)::numeric AS qty
                           FROM qms.imir WHERE grn_date BETWEEN $1 AND $2`, [reg.from, reg.to]);
    expect(reg.truncated).toBe(false);
    expect(reg.rows.length).toBe(t.n);
    expect(reg.rows.filter((r) => r.result === 'NOK').length).toBe(t.nok);

    const ven = ok(await admin.get('/api/v1/reports/vendor-quality'));
    const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    expect(sum(ven.rows, 'lots')).toBe(t.n);
    expect(sum(ven.rows, 'nokLots')).toBe(t.nok);
    expect(sum(ven.rows, 'inwardQty')).toBeCloseTo(Number(t.qty), 3);
    for (const v of ven.rows) {
      expect(v.okLots + v.nokLots).toBe(v.inspected);
      if (v.inspected) expect(v.nokPct).toBeCloseTo(Math.round((1000 * v.nokLots) / v.inspected) / 10, 1);
    }

    const item = ok(await admin.get('/api/v1/reports/item-quality'));
    expect(sum(item.rows, 'lots')).toBe(t.n);
    expect(sum(item.rows, 'nokLots')).toBe(t.nok);
  });

  it('pending ageing lists exactly the open lots', async () => {
    const r = ok(await admin.get('/api/v1/reports/pending-ageing'));
    const [t] = await q('SELECT count(*)::int AS n FROM qms.imir WHERE status <> ALL($1)', [CLOSED]);
    expect(r.rows.length).toBe(t.n);
  });
});

describe('SAP pull', () => {
  it('asks SAP again from a few days before the last date, so late lots are not missed', async () => {
    const { overlapFrom } = await import('../src/integrations/sap/index.js');
    expect(overlapFrom('2026-10-07', 3)).toBe('2026-10-04');
    expect(overlapFrom('2026-03-01', 3)).toBe('2026-02-26');
    expect(overlapFrom('2026-10-07', 0)).toBe('2026-10-07');
    expect(overlapFrom('12345', 3)).toBe('12345'); // the demo queue's cursor is a position, not a date
  });
});
