// Creates one demo account per role, for testing the workflow end to end.
//   npm run demo-users                 (password generated and printed once)
//   DEMO_PASSWORD=... npm run demo-users
// Roles that belong to a plant are given plant DEMO_PLANT (SAP code, default 1115). Accounts are
// named DEMO-<ROLE>; running again resets their password and roles. Their e-mail addresses are
// placeholders on the reserved .test domain: set MAIL_REDIRECT_TO to receive their mail yourself.
// Never run against production.
import { randomInt } from 'node:crypto';
import { password as passwordRule, ROLE_DEFINITIONS } from '@qmas/shared';
import { createPool } from '../src/db/pool.js';
import { hashPassword } from '../src/modules/auth/password.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to create demo accounts in production.');
  process.exit(1);
}

const SHORT = {
  SYSTEM_ADMIN: 'ADMIN', IQC_INSPECTOR: 'INSP', IQC_INCHARGE: 'INCH', IQC_HEAD: 'IQCHEAD', SCM_REQUESTOR: 'SCM', SCM_SUB_HEAD: 'SCMSUB',
  SCM_HEAD: 'SCMHEAD', VD_REQUESTOR: 'VD', VD_SUB_HEAD: 'VDSUB', VD_HEAD: 'VDHEAD', PLANT_HEAD: 'PLANTHEAD', PLANT_QA_HEAD: 'PLANTQA',
  PDC_HEAD: 'PDC', CQA_HEAD: 'CQA', CENTRAL_OPS_HEAD: 'OPSHEAD', PLANT_OPS_HEAD: 'PLANTOPS', AUDITOR: 'AUDIT',
};
// Roles scoped to one plant in practice (their action scope is the plant), even if not required.
const PLANT_ROLES = new Set(['PLANT_HEAD', 'PLANT_QA_HEAD']);

const password = process.env.DEMO_PASSWORD ?? `Qmas-demo-${randomInt(1000, 9999)}`;
const check = passwordRule.safeParse(password);
if (!check.success) {
  console.error(check.error.issues[0].message);
  process.exit(1);
}

const pool = createPool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: process.env.DB_SSL === 'true' });
const client = await pool.connect();
const created = [];
try {
  await client.query('BEGIN');
  const plantCode = process.env.DEMO_PLANT ?? '1115';
  const { rows: plants } = await client.query('SELECT id, name FROM core.plant WHERE sap_code = $1', [plantCode]);
  if (!plants[0]) throw new Error(`Plant ${plantCode} is not in the plant master.`);
  const plant = plants[0];
  const hash = await hashPassword(password);

  for (const role of ROLE_DEFINITIONS) {
    const code = `DEMO-${SHORT[role.code] ?? role.code}`;
    const email = `${code.toLowerCase()}@qmas-demo.test`;
    const { rows } = await client.query(
      `INSERT INTO core.app_user (employee_code, full_name, email, password_hash, must_change_password, is_active)
       VALUES ($1, $2, $3, $4, false, true)
       ON CONFLICT (employee_code) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = false, is_active = true,
              failed_login_count = 0, locked_until = NULL, token_version = core.app_user.token_version + 1
       RETURNING id`,
      [code, `Demo ${role.name}`, email, hash],
    );
    const userId = rows[0].id;
    await client.query('DELETE FROM core.user_role WHERE user_id = $1', [userId]);
    const plantId = role.requiresPlant || PLANT_ROLES.has(role.code) ? plant.id : null;
    await client.query('INSERT INTO core.user_role (user_id, role_code, plant_id) VALUES ($1, $2, $3)', [userId, role.code, plantId]);
    created.push({ code, role: role.name, plant: plantId ? `${plantCode} ${plant.name}` : 'All plants' });
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

if (created.length) {
  console.log(`\nDemo accounts (all use the same password): ${password}\n`);
  const w = Math.max(...created.map((c) => c.code.length));
  for (const c of created) console.log(`  ${c.code.padEnd(w)}  ${c.role.padEnd(26)}  ${c.plant}`);
  console.log('\nRun again to reset them. Their mail goes to MAIL_REDIRECT_TO when that is set.');
}
