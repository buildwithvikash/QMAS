import { Router } from 'express';
import { PERMISSIONS } from '@qmas/shared';
import { z } from 'zod';
import { getPool } from '../../db/pool.js';
import { validate } from '../../middlewares/validate.js';
import { ok, query } from '../../shared/http.js';
import { likeContains } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';

/**
 * Global search (Ctrl+K): documents by number and masters by code or name, each group only when
 * the user may see it and only within their plants. A few results per group, best matches first.
 */
const router = Router();
const LIMIT = 6;

function scopeOf(user, permission) {
  if (!user.permissions.has(permission)) return null;
  return plantScope(user, permission, 'view');
}

router.get('/', validate({ query: z.object({ q: z.string().trim().min(2).max(60) }) }), async (req, res) => {
  const { q } = query(req);
  const like = likeContains(q);
  const prefix = `${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const db = getPool();
  const groups = [];

  const run = async (permission, plantCol, sql, map) => {
    const scope = scopeOf(req.user, permission);
    if (!scope) return [];
    const args = [like, prefix, LIMIT];
    const plant = scope.all ? '' : `AND ${plantCol} = ANY($4)`;
    if (!scope.all) args.push(scope.plantIds);
    const { rows } = await db.query(sql(plant), args);
    return rows.map(map);
  };

  const imirs = await run(PERMISSIONS.IMIR_VIEW, 'm.plant_id', (plant) => `
    SELECT m.id, m.imir_no, m.status, m.grn_no, l.sap_lot_no, i.item_code, i.description, v.name AS vendor
      FROM qms.imir m JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id JOIN intg.sap_inspection_lot l ON l.id = m.sap_lot_id
     WHERE (m.imir_no ILIKE $1 OR m.grn_no ILIKE $1 OR l.sap_lot_no ILIKE $1) ${plant}
     ORDER BY (m.imir_no ILIKE $2 OR m.grn_no ILIKE $2) DESC, m.created_at DESC LIMIT $3`,
  (r) => ({ id: r.id, title: r.imir_no ?? `SAP lot ${r.sap_lot_no}`, subtitle: `${r.item_code} · ${r.description} · ${r.vendor}`, meta: r.status, link: `/imirs/${r.id}` }));
  if (imirs.length) groups.push({ key: 'imir', label: 'Inspection reports', items: imirs });

  const devs = await run(PERMISSIONS.DEVIATION_VIEW, 'd.plant_id', (plant) => `
    SELECT d.id, d.deviation_no, d.stage, d.department, i.item_code, v.name AS vendor
      FROM qms.deviation d JOIN qms.imir m ON m.id = d.imir_id JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
     WHERE d.deviation_no ILIKE $1 ${plant} ORDER BY (d.deviation_no ILIKE $2) DESC, d.created_at DESC LIMIT $3`,
  (r) => ({ id: r.id, title: r.deviation_no, subtitle: `${r.item_code} · ${r.vendor} · ${r.department}`, meta: r.stage, link: `/deviations/${r.id}` }));
  if (devs.length) groups.push({ key: 'deviation', label: 'Deviations', items: devs });

  const dns = await run(PERMISSIONS.DN_VIEW, 'n.plant_id', (plant) => `
    SELECT n.id, n.dn_no, n.status, i.item_code, v.name AS vendor
      FROM qms.defect_notification n JOIN mst.item i ON i.id = n.item_id JOIN mst.vendor v ON v.id = n.vendor_id
     WHERE n.dn_no ILIKE $1 ${plant} ORDER BY (n.dn_no ILIKE $2) DESC, n.dn_date DESC LIMIT $3`,
  (r) => ({ id: r.id, title: r.dn_no, subtitle: `${r.item_code} · ${r.vendor}`, meta: r.status, link: `/dns/${r.id}` }));
  if (dns.length) groups.push({ key: 'dn', label: 'Defect notifications', items: dns });

  // Masters are not plant-specific.
  if (req.user.permissions.has(PERMISSIONS.IMIR_VIEW) || req.user.permissions.has(PERMISSIONS.MASTERS_VIEW)) {
    const { rows: items } = await db.query(
      `SELECT i.id, i.item_code, i.description, f.current_version_id IS NOT NULL AS has_format FROM mst.item i LEFT JOIN qms.format f ON f.item_id = i.id
        WHERE i.item_code ILIKE $1 OR i.description ILIKE $1 ORDER BY (i.item_code ILIKE $2) DESC, i.item_code LIMIT $3`,
      [like, prefix, LIMIT],
    );
    const canFormats = req.user.permissions.has(PERMISSIONS.FORMATS_VIEW);
    if (items.length) {
      groups.push({
        key: 'item', label: 'Items',
        items: items.map((r) => ({ id: String(r.id), title: r.item_code, subtitle: r.description, meta: r.has_format ? 'Format approved' : 'No approved format', link: canFormats ? `/formats/items/${r.id}` : `/imirs?q=${encodeURIComponent(r.item_code)}` })),
      });
    }
    const { rows: vendors } = await db.query(
      'SELECT id, vendor_code, name FROM mst.vendor WHERE vendor_code ILIKE $1 OR name ILIKE $1 ORDER BY (vendor_code ILIKE $2 OR name ILIKE $2) DESC, name LIMIT $3',
      [like, prefix, LIMIT],
    );
    if (vendors.length) {
      groups.push({ key: 'vendor', label: 'Vendors', items: vendors.map((r) => ({ id: String(r.id), title: r.name, subtitle: r.vendor_code, meta: 'Show lots', link: `/imirs?q=${encodeURIComponent(r.vendor_code)}` })) });
    }
  }
  ok(res, groups);
});

export default router;
