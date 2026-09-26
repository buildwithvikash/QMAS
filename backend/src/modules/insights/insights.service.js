import { DRIFT_RULES, defectProbability, driftCheck, INSPECTION_LEVELS, inspectionFocus, PERMISSIONS, supplierRisk } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { camelRows } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';
import * as imirService from '../imir/imir.service.js';

/**
 * Quality insights from the inspection history, computed on request (no AI): measurement drift,
 * historical defect alerts, where to look first, supplier risk with the recommended inspection
 * level, and the chance a lot fails. The rules live in @qmas/shared (logic/insights.js).
 */

const HISTORY_LOTS = 30; // earlier lots of the item considered
const RECENT_LOTS = 10; // "recently" for fail rates
const RISK_DAYS = 180; // supplier risk window
const HALF_LIFE_DAYS = 90; // weight of a lot halves every 90 days (defect probability)
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Overall Not-OK rate in the risk window: the base rate small histories are pulled toward. */
async function baseRate(db) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE result = 'NOK')::numeric / nullif(count(*), 0) AS rate
       FROM qms.imir WHERE result IS NOT NULL AND submitted_at > now() - make_interval(days => $1)`,
    [RISK_DAYS],
  );
  const r = num(rows[0].rate);
  return r && r > 0 ? Math.min(r, 0.5) : 0.05;
}

/** Risk figures for vendors, from their lots, deviations and DNs in the window. */
async function vendorHistory(db, vendorIds) {
  const { rows } = await db.query(
    `WITH lots AS (
       SELECT m.id, m.vendor_id, m.item_id, m.result, m.submitted_at,
              row_number() OVER (PARTITION BY m.vendor_id ORDER BY m.submitted_at DESC) AS rn
         FROM qms.imir m
        WHERE m.vendor_id = ANY($1) AND m.result IS NOT NULL AND m.submitted_at > now() - make_interval(days => $2)
     ), streak AS (
       SELECT vendor_id, coalesce(min(rn) FILTER (WHERE result = 'NOK') - 1, max(rn)) AS ok_streak FROM lots GROUP BY vendor_id
     ), repeats AS (
       SELECT l.vendor_id, count(*)::int AS repeat_defects FROM (
         SELECT l.vendor_id, l.item_id, c.checkpoint_uid FROM lots l JOIN qms.imir_checkpoint c ON c.imir_id = l.id AND c.result = 'NOK'
          GROUP BY 1, 2, 3 HAVING count(*) >= 2) l GROUP BY l.vendor_id
     )
     SELECT v.id AS vendor_id, v.vendor_code, v.name AS vendor_name,
            (SELECT count(*) FROM lots l WHERE l.vendor_id = v.id)::int AS lots,
            (SELECT count(*) FROM lots l WHERE l.vendor_id = v.id AND l.result = 'NOK')::int AS nok,
            (SELECT count(*) FROM qms.deviation d JOIN qms.imir m ON m.id = d.imir_id
              WHERE m.vendor_id = v.id AND d.severity IN ('MAJOR', 'CRITICAL') AND d.created_at > now() - make_interval(days => $2))::int AS major_deviations,
            (SELECT count(*) FROM qms.defect_notification n WHERE n.vendor_id = v.id AND n.created_at > now() - make_interval(days => $2))::int AS dns,
            coalesce((SELECT repeat_defects FROM repeats r WHERE r.vendor_id = v.id), 0) AS repeat_defects,
            coalesce((SELECT ok_streak FROM streak s WHERE s.vendor_id = v.id), 0)::int AS ok_streak
       FROM mst.vendor v WHERE v.id = ANY($1)`,
    [vendorIds, RISK_DAYS],
  );
  return camelRows(rows);
}

function riskOf(h, base) {
  const r = supplierRisk(h, { baseRate: base });
  return { vendorId: h.vendorId, vendorCode: h.vendorCode, vendorName: h.vendorName, lots: h.lots, nok: h.nok, ...r, recommendationText: INSPECTION_LEVELS[r.recommendation] };
}

/** Recency-weighted lot counts for the same vendor and item, the vendor, and the item. */
async function probabilityFor(db, { vendorId, itemId, excludeId = null }, base) {
  const { rows } = await db.query(
    `SELECT sum(w) FILTER (WHERE vendor_id = $1 AND item_id = $2) AS vi_lots, sum(w) FILTER (WHERE vendor_id = $1 AND item_id = $2 AND nok) AS vi_nok,
            sum(w) FILTER (WHERE vendor_id = $1) AS v_lots, sum(w) FILTER (WHERE vendor_id = $1 AND nok) AS v_nok,
            sum(w) FILTER (WHERE item_id = $2) AS i_lots, sum(w) FILTER (WHERE item_id = $2 AND nok) AS i_nok
       FROM (SELECT vendor_id, item_id, result = 'NOK' AS nok, power(0.5, extract(epoch FROM now() - submitted_at) / 86400 / $3) AS w
               FROM qms.imir WHERE (vendor_id = $1 OR item_id = $2) AND result IS NOT NULL AND id IS DISTINCT FROM $4) x`,
    [vendorId, itemId, HALF_LIFE_DAYS, excludeId],
  );
  const r = rows[0];
  const c = (lots, nok) => ({ lots: num(lots) ?? 0, nok: num(nok) ?? 0 });
  return defectProbability({ vendorItem: c(r.vi_lots, r.vi_nok), vendor: c(r.v_lots, r.v_nok), item: c(r.i_lots, r.i_nok) }, { baseRate: base });
}

/**
 * Everything the IMIR page shows about a lot: per checkpoint its history (fails, last failure,
 * usual values) and drift, alerts for recurring or recent defects, where to look first, supplier
 * risk, and (for Incharge and above) the chance this lot fails.
 */
export async function lotInsights(id, user) {
  const imir = await imirService.detail(id, user); // checks the user may see the lot
  const db = getPool();
  const base = await baseRate(db);
  const [vendor] = await vendorHistory(db, [imir.vendorId]);
  const supplier = riskOf(vendor, base);
  const canSeePrediction = user.assignments.some((a) => a.permissions.includes(PERMISSIONS.AI_ASSIST));
  const prediction = canSeePrediction ? await probabilityFor(db, { vendorId: imir.vendorId, itemId: imir.itemId, excludeId: imir.id }, base) : null;

  // Earlier lots of the item, newest first, with each checkpoint's lot average and result.
  const { rows: lotRows } = await db.query(
    `SELECT m.id, m.imir_no, m.vendor_id, m.result, m.submitted_at FROM qms.imir m
      WHERE m.item_id = $1 AND m.id <> $2 AND m.result IS NOT NULL ORDER BY m.submitted_at DESC LIMIT $3`,
    [imir.itemId, imir.id, HISTORY_LOTS],
  );
  const lots = camelRows(lotRows);
  const lotIds = lots.map((l) => l.id);
  const { rows: per } = lotIds.length
    ? await db.query(
      `SELECT c.imir_id, c.checkpoint_uid, c.result, c.text_observation,
              (SELECT avg(o.value_num) FROM qms.imir_observation o WHERE o.imir_id = c.imir_id AND o.checkpoint_uid = c.checkpoint_uid) AS mean,
              (SELECT array_agg(o.value_num ORDER BY o.sample_no) FROM qms.imir_observation o
                WHERE o.imir_id = c.imir_id AND o.checkpoint_uid = c.checkpoint_uid AND o.decision = 'NOK' AND o.value_num IS NOT NULL) AS nok_values
         FROM qms.imir_checkpoint c WHERE c.imir_id = ANY($1)`,
      [lotIds],
    )
    : { rows: [] };
  // Usual values of each reading: this vendor's lots when there are enough, else all of the item's.
  const vendorLotIds = lots.filter((l) => l.vendorId === imir.vendorId).map((l) => l.id);
  const statLots = vendorLotIds.length >= DRIFT_RULES.minHistory ? vendorLotIds : lotIds;
  const { rows: statRows } = lotIds.length
    ? await db.query(
      `SELECT checkpoint_uid, avg(value_num) AS mean, stddev_samp(value_num) AS sd, count(value_num)::int AS n
         FROM qms.imir_observation WHERE imir_id = ANY($1) AND value_num IS NOT NULL GROUP BY checkpoint_uid`,
      [statLots],
    )
    : { rows: [] };
  const statsByUid = new Map(statRows.map((r) => [r.checkpoint_uid, { mean: num(r.mean), sd: num(r.sd) ?? 0, n: r.n }]));
  const lotById = new Map(lots.map((l, i) => [l.id, { ...l, order: i }]));
  const rowsByUid = new Map();
  for (const r of per) rowsByUid.set(r.checkpoint_uid, [...(rowsByUid.get(r.checkpoint_uid) ?? []), { ...r, lot: lotById.get(r.imir_id) }]);

  const current = new Map();
  for (const c of imir.cells) if (c.value !== null && c.value !== undefined) current.set(c.checkpointUid, [...(current.get(c.checkpointUid) ?? []), c.value]);
  const sameVendorLotIds = new Set(vendorLotIds);
  const lastVendorLot = lots.find((l) => l.vendorId === imir.vendorId) ?? null;

  const checkpoints = {};
  const focusInput = [];
  const alerts = [];
  for (const cp of imir.checkpoints) {
    const rows = (rowsByUid.get(cp.uid) ?? []).sort((a, b) => a.lot.order - b.lot.order); // newest first
    const recent = rows.slice(0, RECENT_LOTS);
    const fails = rows.filter((r) => r.result === 'NOK');
    const recentFails = recent.filter((r) => r.result === 'NOK').length;
    const sameVendorFails = fails.filter((r) => sameVendorLotIds.has(r.imir_id)).length;
    const lastFail = fails[0] ?? null;
    const failedLastLot = !!lastVendorLot && rows.some((r) => r.imir_id === lastVendorLot.id && r.result === 'NOK');

    let drift = null;
    let lotMeans = [];
    if (cp.section === 'DIMENSIONAL') {
      const vendorRows = rows.filter((r) => sameVendorLotIds.has(r.imir_id) && r.mean !== null);
      const source = vendorRows.length >= 3 ? vendorRows : rows.filter((r) => r.mean !== null);
      lotMeans = source.slice(0, 12).reverse().map((r) => ({ at: r.lot.submittedAt, mean: num(r.mean), imirNo: r.lot.imirNo }));
      drift = driftCheck({ history: lotMeans, current: current.get(cp.uid) ?? [], spec: cp, unit: cp.uom ?? '' });
    }
    checkpoints[cp.uid] = {
      lots: rows.length,
      fails: fails.length,
      recentLots: recent.length,
      recentFails,
      sameVendorFails,
      failedLastLot,
      lastFail: lastFail ? { at: lastFail.lot.submittedAt, imirNo: lastFail.lot.imirNo, values: (lastFail.nok_values ?? []).map(num), observation: lastFail.text_observation } : null,
      stats: statsByUid.get(cp.uid) ?? null,
      lotMeans,
      drift,
    };
    focusInput.push({ uid: cp.uid, name: cp.checkpoint, recentLots: recent.length, recentFails, failedLastLot, drift });

    // Historical defect alerts: recurring, repeated with this vendor, or failed in the vendor's last lot.
    if (recentFails >= 2 || sameVendorFails >= 2 || failedLastLot) {
      const bits = [];
      if (recentFails) bits.push(`failed in ${recentFails} of the last ${recent.length} lots of this item`);
      if (sameVendorFails) bits.push(`${sameVendorFails} time${sameVendorFails === 1 ? '' : 's'} with ${imir.vendorName}`);
      if (failedLastLot) bits.push(`also Not OK in ${lastVendorLot.imirNo}, this vendor's previous lot`);
      alerts.push({
        uid: cp.uid, checkpoint: cp.checkpoint, level: sameVendorFails >= 2 || failedLastLot ? 'HIGH' : 'MEDIUM',
        text: bits.join('; '), lastFail: checkpoints[cp.uid].lastFail,
      });
    }
    if (drift && ['TREND', 'SHIFT'].includes(drift.status) && !current.has(cp.uid)) {
      alerts.push({ uid: cp.uid, checkpoint: cp.checkpoint, level: 'MEDIUM', text: drift.message, kind: 'DRIFT' });
    }
  }

  return {
    supplier,
    prediction,
    checkpoints,
    alerts: alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'HIGH' ? -1 : 1)),
    focus: inspectionFocus(focusInput),
    basis: { historyLots: lots.length, sameVendorLots: sameVendorLotIds.size, windowDays: RISK_DAYS },
  };
}

/**
 * Plant-wide insights for Incharge and above: supplier risk ranking, open lots most likely to
 * fail, and characteristics drifting in recent lots, within the user's plants.
 */
export async function overview(user) {
  const scope = plantScope(user, PERMISSIONS.AI_ASSIST, 'view');
  const args = scope.all ? [] : [scope.plantIds];
  const inScope = (col) => (scope.all ? 'true' : `${col} = ANY($1)`);
  const db = getPool();
  const base = await baseRate(db);

  const { rows: vIds } = await db.query(
    `SELECT DISTINCT vendor_id FROM qms.imir m WHERE ${inScope('m.plant_id')} AND m.created_at > now() - make_interval(days => ${RISK_DAYS})`,
    args,
  );
  const vendors = vIds.length ? (await vendorHistory(db, vIds.map((r) => r.vendor_id))).map((h) => riskOf(h, base)).filter((v) => v.lots > 0) : [];
  vendors.sort((a, b) => b.score - a.score);

  const { rows: open } = await db.query(
    `SELECT m.id, m.imir_no, m.status, m.vendor_id, m.item_id, i.item_code, i.description AS item_description, v.name AS vendor_name,
            p.sap_code AS plant_sap_code, p.name AS plant_name, m.created_at
       FROM qms.imir m JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id JOIN core.plant p ON p.id = m.plant_id
      WHERE ${inScope('m.plant_id')} AND m.status IN ('AWAITING_FORMAT', 'OPEN', 'IN_INSPECTION')
      ORDER BY m.created_at LIMIT 200`,
    args,
  );
  const openLots = [];
  for (const m of camelRows(open)) openLots.push({ ...m, ...(await probabilityFor(db, { vendorId: m.vendorId, itemId: m.itemId }, base)) });
  openLots.sort((a, b) => b.probability - a.probability);

  // Drift: each item, vendor and dimensional checkpoint with lots in the last 90 days; the latest
  // lot is checked against the ones before it.
  const { rows: series } = await db.query(
    `SELECT m.item_id, i.item_code, i.description AS item_description, m.vendor_id, v.name AS vendor_name, o.checkpoint_uid,
            fc.checkpoint, fc.nominal, fc.lsl, fc.usl, fc.uom,
            json_agg(json_build_object('id', m.id, 'imirNo', m.imir_no, 'at', m.submitted_at, 'mean', o.mean, 'values', o.vals) ORDER BY m.submitted_at) AS lots
       FROM qms.imir m
       JOIN LATERAL (SELECT checkpoint_uid, avg(value_num) AS mean, array_agg(value_num) AS vals FROM qms.imir_observation
                      WHERE imir_id = m.id AND value_num IS NOT NULL GROUP BY checkpoint_uid) o ON true
       JOIN qms.format_checkpoint fc ON fc.version_id = m.format_version_id AND fc.checkpoint_uid = o.checkpoint_uid AND fc.section = 'DIMENSIONAL'
       JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
      WHERE ${inScope('m.plant_id')} AND m.result IS NOT NULL AND m.submitted_at > now() - interval '365 days'
      GROUP BY m.item_id, i.item_code, i.description, m.vendor_id, v.name, o.checkpoint_uid, fc.checkpoint, fc.nominal, fc.lsl, fc.usl, fc.uom
     HAVING max(m.submitted_at) > now() - interval '90 days'`,
    args,
  );
  const drift = [];
  for (const s of camelRows(series)) {
    const lots = s.lots;
    const latest = lots.at(-1);
    const d = driftCheck({
      history: lots.slice(0, -1).map((l) => ({ at: l.at, mean: l.mean })),
      current: (latest.values ?? []).map(Number),
      spec: { nominal: num(s.nominal), lsl: num(s.lsl), usl: num(s.usl) },
      unit: s.uom ?? '',
    });
    if (['NEAR_LIMIT', 'SHIFT', 'TREND'].includes(d.status)) {
      drift.push({
        itemCode: s.itemCode, itemDescription: s.itemDescription, vendorName: s.vendorName, checkpoint: s.checkpoint,
        status: d.status, direction: d.direction, message: d.message, imirId: latest.id, imirNo: latest.imirNo, at: latest.at,
        means: lots.slice(-8).map((l) => num(l.mean)), lsl: num(s.lsl), usl: num(s.usl),
      });
    }
  }
  drift.sort((a, b) => new Date(b.at) - new Date(a.at));

  return { vendors: vendors.slice(0, 25), openLots: openLots.slice(0, 15), drift: drift.slice(0, 25), baseRate: base, windowDays: RISK_DAYS };
}
