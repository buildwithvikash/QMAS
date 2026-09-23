import {
  DEFAULT_ROLE_PERMISSIONS,
  DEVIATION_ACTIONS,
  DEVIATION_SEVERITIES,
  ESCALATION_RANKS,
  PERMISSION_DEFINITIONS,
  PROCEDURE_SAMPLING_ROWS,
  ROLE_DEFINITIONS,
  ROLES,
} from '@qmas/shared';

/** Plants from the blueprint numbering sheet (SAP code, 2-digit code). */
const PLANTS = [
  ['1111', '01', 'Silvassa'],
  ['1115', '03', 'Sanjan'],
  ['1125', '04', 'Tadgam'],
  ['1120', '05', 'Shahpur'],
  ['1191', '06', 'Tumb'],
  ['1130', '07', 'Malav'],
  ['1179', '08', 'Tumb FG 1'],
];

/** Both numbering options from the blueprint; option 1 is active until an admin changes it. */
const NUMBER_SERIES = [
  ['IMIR', 'IMIR{PLANT_SAP}{YY}{MM}{DD}{SEQ:3}', 'DAY', true, 'Blueprint option 1 (SAP plant code)'],
  ['IMIR', 'IMIR{PLANT_SHORT}{YY}{MM}{DD}{SEQ:3}', 'DAY', false, 'Blueprint option 2 (2-digit plant code)'],
  ['DN', 'DN{PLANT_SAP}{SRC}{YY}{MM}{SEQ:3}', 'MONTH', true, 'Blueprint option 1 (SAP plant code)'],
  ['DN', 'DN{PLANT_SHORT}{SRC}{YY}{MM}{SEQ:3}', 'MONTH', false, 'Blueprint option 2 (2-digit plant code)'],
  ['DEVIATION', 'DEV{PLANT_SAP}{YY}{MM}{SEQ:3}', 'MONTH', true, 'Initial pattern, to be confirmed by QA'],
];

/**
 * Idempotent reference data. Code-owned lists (roles, permissions, lookups) are upserted on every
 * run; business-owned data (plants, sampling table, number series, role grants) is only created
 * when missing, so changes made through the app are never overwritten.
 */
export async function seedReferenceData(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [i, r] of ROLE_DEFINITIONS.entries()) {
      await client.query(
        `INSERT INTO core.role (code, name, department, view_scope, action_scope, requires_plant, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, department = EXCLUDED.department,
           view_scope = EXCLUDED.view_scope, action_scope = EXCLUDED.action_scope,
           requires_plant = EXCLUDED.requires_plant, sort_order = EXCLUDED.sort_order`,
        [r.code, r.name, r.department, r.viewScope, r.actionScope, r.requiresPlant, i],
      );
    }

    for (const [i, p] of PERMISSION_DEFINITIONS.entries()) {
      await client.query(
        `INSERT INTO core.permission (key, module, description, sort_order) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
        [p.key, p.module, p.description, i],
      );
    }

    // Default grants only for roles that have none yet; System Admin always holds every permission.
    for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const { rows } = await client.query('SELECT 1 FROM core.role_permission WHERE role_code = $1 LIMIT 1', [role]);
      if (rows.length === 0 || role === ROLES.SYSTEM_ADMIN) {
        await client.query(
          `INSERT INTO core.role_permission (role_code, permission_key)
           SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
          [role, keys],
        );
      }
    }

    for (const { roleCode, rank } of ESCALATION_RANKS) {
      await client.query(
        `INSERT INTO mst.escalation_authority (role_code, rank) VALUES ($1, $2)
         ON CONFLICT (role_code) DO UPDATE SET rank = EXCLUDED.rank`,
        [roleCode, rank],
      );
    }
    for (const [table, list] of [['mst.deviation_action', DEVIATION_ACTIONS], ['mst.deviation_severity', DEVIATION_SEVERITIES]]) {
      for (const [i, v] of list.entries()) {
        await client.query(
          `INSERT INTO ${table} (code, name, sort_order) VALUES ($1, $2, $3)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
          [v.code, v.name, i],
        );
      }
    }

    const { rows: plantCount } = await client.query('SELECT count(*)::int AS n FROM core.plant');
    if (plantCount[0].n === 0) {
      for (const [sap, short, name] of PLANTS) {
        await client.query('INSERT INTO core.plant (sap_code, short_code, name) VALUES ($1, $2, $3)', [sap, short, name]);
      }
    }

    const { rows: planCount } = await client.query('SELECT count(*)::int AS n FROM mst.sampling_plan');
    if (planCount[0].n === 0) {
      const { rows } = await client.query(
        `INSERT INTO mst.sampling_plan (code, name, description, is_default)
         VALUES ('IQC-STD', 'IQC standard sampling', 'Sampling Inspection Procedure table (lot size → sample size). Acceptance numbers to be added by QA.', true)
         RETURNING id`,
      );
      for (const r of PROCEDURE_SAMPLING_ROWS) {
        await client.query(
          'INSERT INTO mst.sampling_plan_row (plan_id, lot_min, lot_max, sample_size) VALUES ($1, $2, $3, $4)',
          [rows[0].id, r.lotMin, r.lotMax, r.sampleSize],
        );
      }
    }

    const { rows: seriesCount } = await client.query('SELECT count(*)::int AS n FROM core.number_series');
    if (seriesCount[0].n === 0) {
      for (const [docType, pattern, resetScope, isActive, remarks] of NUMBER_SERIES) {
        await client.query(
          `INSERT INTO core.number_series (doc_type, pattern, reset_scope, is_active, remarks, effective_from)
           VALUES ($1, $2, $3, $4, $5, '2026-01-01T00:00:00+05:30')`,
          [docType, pattern, resetScope, isActive, remarks],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
