// Trial AI (demo data only): sign in to Puter in the browser and save the account token for QMAS.
//   npm run puter-login
// Opens puter.com; after you sign in (or create a free account), the token is written to
// backend/.env as PUTER_AUTH_TOKEN with AI_PROVIDER=puter. Restart the API afterwards.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
const { getAuthToken, init } = (await import('@heyputer/puter.js/src/init.cjs')).default;

console.log('Opening puter.com in your browser. Sign in there, then come back here.');
const token = await getAuthToken();
if (!token) {
  console.error('No token received. Run the command again.');
  process.exit(1);
}

// Check the token works before saving it.
try {
  const puter = init(token);
  const user = await puter.auth.getUser();
  console.log(`Signed in to Puter as ${user?.username ?? 'your account'}.`);
} catch {
  console.log('Signed in (could not read the account name; the token is saved anyway).');
}

let env = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const set = (key, value) => {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line) : `${env.replace(/\s*$/, '')}\n${line}\n`;
};
set('AI_PROVIDER', 'puter');
set('PUTER_AUTH_TOKEN', token);
if (!/^PUTER_MODEL=.+$/m.test(env)) set('PUTER_MODEL', 'anthropic/claude-opus-5');
writeFileSync(envFile, env);
console.log('Saved to backend/.env (AI_PROVIDER=puter). Restart the API to use it. For demo data only.');
process.exit(0);
