import { beforeAll, describe, expect, it } from 'vitest';
import { getEnv, setEnv } from '../src/config/env.js';
import { getPool } from '../src/db/pool.js';
import { adminAgent, api, createUser, signIn } from './helpers.js';

let admin;
let adminUser;
const me = (agent) => agent.get('/api/v1/auth/me');
const dataOf = (res) => res.body.data;

beforeAll(async () => {
  ({ agent: admin, user: adminUser } = await adminAgent());
});

/** Runs fn with some settings changed (e.g. several sign-ins allowed), then puts them back. */
async function withSettings(changes, fn) {
  const before = getEnv();
  setEnv({ ...before, ...changes });
  try {
    return await fn();
  } finally {
    setEnv(before);
  }
}

describe('one sign-in at a time', () => {
  it('signs the earlier device out when the user signs in again, and says why', async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const first = await signIn(u);
    const second = await signIn(u);
    const gone = await me(first);
    expect(gone.status).toBe(401);
    expect(gone.body.message).toMatch(/signed in on another device/);
    expect((await first.post('/api/v1/auth/refresh')).body.message).toMatch(/signed in on another device/);
    expect((await me(second)).status).toBe(200);
    const sessions = dataOf(await admin.get(`/api/v1/users/${u.id}/sessions`));
    expect(sessions.map((x) => x.endReason)).toEqual([null, 'REPLACED']);
  });
});

describe('sign-out after inactivity', () => {
  it('ends a web session idle for 30 minutes; activity keeps it, background calls do not', async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const agent = await signIn(u);
    const [s] = dataOf(await admin.get(`/api/v1/users/${u.id}/sessions`));
    expect((await agent.post('/api/v1/auth/activity')).status).toBe(204);
    await getPool().query("UPDATE core.user_session SET last_active_at = now() - interval '29 minutes' WHERE id = $1", [s.id]);
    expect((await me(agent)).status).toBe(200); // not yet
    await getPool().query("UPDATE core.user_session SET last_active_at = now() - interval '31 minutes' WHERE id = $1", [s.id]);
    await new Promise((r) => setTimeout(r, 10_100)); // past the per-request cache
    const gone = await me(agent);
    expect(gone.status).toBe(401);
    expect(gone.body.message).toMatch(/without activity/);
    expect(dataOf(await admin.get(`/api/v1/users/${u.id}/sessions`))[0].endReason).toBe('IDLE');
    expect(dataOf(await api().get('/api/v1/auth/session-policy'))).toEqual({ idleMinutes: 30, singleSession: true });
  }, 40_000);

  it('does not sign tablets out for inactivity', async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const agent = await signIn(u);
    await agent.post('/api/v1/auth/refresh').set('X-Client', 'tablet'); // the tablet's sync marks the session
    const [s] = dataOf(await admin.get(`/api/v1/users/${u.id}/sessions`));
    expect(s.client).toBe('tablet');
    await getPool().query("UPDATE core.user_session SET last_active_at = now() - interval '5 hours' WHERE id = $1", [s.id]);
    expect((await agent.post('/api/v1/auth/refresh').set('X-Client', 'tablet')).status).toBe(200);
  });
});

describe('sessions', () => {
  it('records each sign-in with its address and shows it to administrators', () => withSettings({ SINGLE_SESSION: false }, async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    await signIn(u);
    await signIn(u); // a second device
    const sessions = dataOf(await admin.get('/api/v1/users/sessions')).filter((s) => s.userId === u.id);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ employeeCode: u.employeeCode, client: 'web', active: true, online: true });
    expect(sessions[0].ip).toBeTruthy();
    const listed = dataOf(await admin.get('/api/v1/users').query({ q: u.employeeCode }))[0];
    expect(listed).toMatchObject({ activeSessions: 2, online: true });
    expect(listed.ips.length).toBeGreaterThanOrEqual(1);
    const summary = dataOf(await admin.get('/api/v1/users/summary'));
    expect(summary.sessions).toBeGreaterThanOrEqual(2);
    expect(summary.multiple).toBeGreaterThanOrEqual(1);
    expect(dataOf(await admin.get('/api/v1/users').query({ status: 'multiple', q: u.employeeCode }))).toHaveLength(1);
  }));

  it('ends one device at once, leaving the others signed in', () => withSettings({ SINGLE_SESSION: false }, async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const pc = await signIn(u);
    const tablet = await signIn(u);
    const [latest] = dataOf(await admin.get(`/api/v1/users/${u.id}/sessions`));
    expect(dataOf(await admin.post(`/api/v1/users/sessions/${latest.id}/end`))).toEqual({ ended: 1 });
    const gone = await me(tablet);
    expect(gone.status).toBe(401);
    expect(gone.body.message).toBe('An administrator signed you out. Please sign in again.');
    expect((await tablet.post('/api/v1/auth/refresh')).status).toBe(401); // cannot come back
    expect((await me(pc)).status).toBe(200);
  }));

  it('signs a user out everywhere, or everyone except the administrator', () => withSettings({ SINGLE_SESSION: false }, async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const a = await signIn(u);
    const b = await signIn(u);
    expect(dataOf(await admin.post(`/api/v1/users/${u.id}/force-logout`)).ended).toBe(2);
    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(401);
    expect((await me(await signIn(u))).status).toBe(200); // may sign in again

    const other = await signIn(await createUser({ roles: [{ roleCode: 'AUDITOR' }] }));
    expect(dataOf(await admin.post('/api/v1/users/sessions/end-all')).ended).toBeGreaterThan(0);
    expect((await me(other)).status).toBe(401);
    expect((await me(admin)).status).toBe(200);
    ({ agent: admin, user: adminUser } = await adminAgent());
  }));

  it('refuses to end your own session or lock yourself', async () => {
    expect((await admin.post(`/api/v1/users/${adminUser.id}/force-logout`)).status).toBe(422);
    expect((await admin.post(`/api/v1/users/${adminUser.id}/lock`).send({ reason: 'test' })).status).toBe(422);
    const [mine] = dataOf(await admin.get(`/api/v1/users/${adminUser.id}/sessions`));
    expect((await admin.post(`/api/v1/users/sessions/${mine.id}/end`)).status).toBe(422);
  });
});

describe('administrator lock', () => {
  it('signs the user out and refuses sign-in until unlocked, with the reason on record', async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const agent = await signIn(u);
    expect((await admin.post(`/api/v1/users/${u.id}/lock`).send({ reason: 'x' })).status).toBe(422); // reason too short
    const locked = dataOf(await admin.post(`/api/v1/users/${u.id}/lock`).send({ reason: 'Left the company' }));
    expect(locked).toMatchObject({ isLocked: true, lockedReason: 'Left the company', activeSessions: 0 });
    expect((await me(agent)).status).toBe(401);
    const refused = await api().post('/api/v1/auth/login').send({ employeeCode: u.employeeCode, password: u.password });
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('ACCOUNT_LOCKED_BY_ADMIN');
    const wrong = await api().post('/api/v1/auth/login').send({ employeeCode: u.employeeCode, password: 'Wrong-pass-1' });
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS'); // the lock is not revealed without the password

    expect(dataOf(await admin.post(`/api/v1/users/${u.id}/unlock`))).toMatchObject({ isLocked: false });
    expect((await me(await signIn(u))).status).toBe(200);
    const events = dataOf(await admin.get('/api/v1/audit/auth-events').query({ actorId: u.id })).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(['ADMIN_LOCKED', 'UNLOCKED']));
  });
});

describe('forgot password', () => {
  const linkIn = async (userId) => {
    const { rows } = await getPool().query('SELECT body_text FROM core.mail_outbox WHERE to_user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
    return rows[0]?.body_text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1] ?? null;
  };

  it('mails a one-time link that sets a new password and signs out every device', async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const email = `${u.employeeCode.toLowerCase()}@example.com`;
    await getPool().query('UPDATE core.app_user SET email = $2 WHERE id = $1', [u.id, email]);
    const old = await signIn(u);

    const asked = await api().post('/api/v1/auth/forgot-password').send({ login: email });
    expect(asked.status).toBe(200);
    const token = await linkIn(u.id);
    expect(token).toBeTruthy();
    expect(dataOf(await api().get('/api/v1/auth/reset-password').query({ token }))).toMatchObject({ valid: true, employeeCode: u.employeeCode });

    const mismatch = await api().post('/api/v1/auth/reset-password').send({ token, newPassword: 'NewPass-2026', confirmPassword: 'Other-2026' });
    expect(mismatch.status).toBe(422);
    ok(await api().post('/api/v1/auth/reset-password').send({ token, newPassword: 'NewPass-2026', confirmPassword: 'NewPass-2026' }));
    expect((await me(old)).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ employeeCode: u.employeeCode, password: 'NewPass-2026' })).status).toBe(200);

    const again = await api().post('/api/v1/auth/reset-password').send({ token, newPassword: 'Another-2026', confirmPassword: 'Another-2026' });
    expect(again.status).toBe(422);
    expect(dataOf(await api().get('/api/v1/auth/reset-password').query({ token })).valid).toBe(false);
  });

  it('answers the same for unknown accounts and accounts without e-mail, and sends nothing', async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] }); // no e-mail
    const a = await api().post('/api/v1/auth/forgot-password').send({ login: 'NOBODY-HERE' });
    const b = await api().post('/api/v1/auth/forgot-password').send({ login: u.employeeCode });
    expect(a.body.data.message).toBe(b.body.data.message);
    expect(await linkIn(u.id)).toBeNull();
  });

  it('lets an administrator e-mail a reset link, and says why when it cannot', async () => {
    const u = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const noMail = await admin.post(`/api/v1/users/${u.id}/send-reset-link`);
    expect(noMail.status).toBe(422);
    await getPool().query('UPDATE core.app_user SET email = $2 WHERE id = $1', [u.id, `${u.employeeCode.toLowerCase()}@example.com`]);
    expect(dataOf(await admin.post(`/api/v1/users/${u.id}/send-reset-link`))).toMatchObject({ minutes: 30 });
    expect(await linkIn(u.id)).toBeTruthy();
  });
});

function ok(res) {
  if (res.status >= 300) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}
