// Creates the first System Admin (or resets an existing user into one).
//   npm run create-admin -- --employee-code ADMIN01 --name "System Administrator"
// The password is read from QMAS_ADMIN_PASSWORD or asked for interactively; it is never stored in code.
// The account must change the password at first sign-in.
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { password as passwordRule } from '@qmas/shared';
import { createPool } from '../src/db/pool.js';
import { hashPassword } from '../src/modules/auth/password.js';

const { values } = parseArgs({ options: { 'employee-code': { type: 'string' }, name: { type: 'string' } } });
const employeeCode = values['employee-code']?.trim().toUpperCase();
const fullName = values.name?.trim() || 'System Administrator';
if (!employeeCode) {
  console.error('Usage: npm run create-admin -- --employee-code ADMIN01 --name "System Administrator"');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const password = process.env.QMAS_ADMIN_PASSWORD ?? (await askHidden('Temporary password for the admin: '));
const check = passwordRule.safeParse(password);
if (!check.success) {
  console.error(check.error.issues[0].message);
  process.exit(1);
}

const pool = createPool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: process.env.DB_SSL === 'true' });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const hash = await hashPassword(password);
  const { rows } = await client.query(
    `INSERT INTO core.app_user (employee_code, full_name, password_hash, must_change_password)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (employee_code) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = true,
       is_active = true, locked_until = NULL, failed_login_count = 0, token_version = core.app_user.token_version + 1
     RETURNING id`,
    [employeeCode, fullName, hash],
  );
  await client.query(
    `INSERT INTO core.user_role (user_id, role_code) VALUES ($1, 'SYSTEM_ADMIN')
     ON CONFLICT (user_id, role_code, COALESCE(plant_id, 0)) DO NOTHING`,
    [rows[0].id],
  );
  await client.query('COMMIT');
  console.log(`System Admin ${employeeCode} is ready. Sign in and change the temporary password.`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
