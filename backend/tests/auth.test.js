import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { getPool } from '../src/db/pool.js';
import { hashToken } from '../src/modules/auth/tokens.js';
import { api, createUser, getApp, signIn } from './helpers.js';

const login = (body) => api().post('/api/v1/auth/login').send(body);
const cookieValue = (res, name) => res.headers['set-cookie']?.find((c) => c.startsWith(`${name}=`))?.split(';')[0].split('=')[1];

describe('health', () => {
  it('reports liveness and readiness', async () => {
    expect((await api().get('/api/v1/health')).body).toEqual({ status: 'ok' });
    expect((await api().get('/api/v1/ready')).body).toEqual({ status: 'ready' });
  });

  it('returns 404 JSON for unknown API routes', async () => {
    const res = await api().get('/api/v1/nope');
    expect(res.status).toBe(401); // everything below /auth needs a session first
    const anon = await api().get('/api/nope');
    expect(anon.status).toBe(404);
    expect(anon.body.success).toBe(false);
  });
});

describe('sign-in', () => {
  it('signs in, sets httpOnly cookies and returns the session user', async () => {
    const user = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    const res = await login({ employeeCode: user.employeeCode.toLowerCase(), password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ employeeCode: user.employeeCode, mustChangePassword: false });
    expect(res.body.data.user.permissions).toContain('audit.view');
    expect(res.body.data.accessToken).toBeUndefined();
    const cookies = res.headers['set-cookie'].join(';');
    expect(cookies).toMatch(/qmas_at=.*HttpOnly/);
    expect(cookies).toMatch(/qmas_rt=.*Path=\/api\/v1\/auth/);
    expect(cookies).toMatch(/SameSite=Strict/);
  });

  it('returns tokens in the body only for the tablet client', async () => {
    const user = await createUser();
    const res = await api().post('/api/v1/auth/login').set('X-Client', 'tablet').send({ employeeCode: user.employeeCode, password: user.password });
    expect(res.body.data.accessToken).toBeTruthy();
    const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('gives the same message for an unknown user and a wrong password', async () => {
    const user = await createUser();
    const unknown = await login({ employeeCode: 'NOBODY-XYZ', password: 'whatever123' });
    const wrong = await login({ employeeCode: user.employeeCode, password: 'wrong-password1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.message).toBe('Employee code or password is incorrect.');
    expect(wrong.body.message).toMatch(/^Employee code or password is incorrect\. 4 attempts left/);
  });

  it('locks the account after 5 failures, even for the right password, until unlocked', async () => {
    const user = await createUser();
    for (let i = 0; i < 4; i += 1) await login({ employeeCode: user.employeeCode, password: 'bad-password1' });
    const fifth = await login({ employeeCode: user.employeeCode, password: 'bad-password1' });
    expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
    const right = await login({ employeeCode: user.employeeCode, password: user.password });
    expect(right.status).toBe(401);
    expect(right.body.code).toBe('ACCOUNT_LOCKED');

    const { rows } = await getPool().query("SELECT event FROM audit.auth_event WHERE user_id = $1 ORDER BY id", [user.id]);
    expect(rows.map((r) => r.event)).toEqual(['LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOCKED', 'LOGIN_FAILED']);
  });

  it('refuses a deactivated account only after the password is verified', async () => {
    const user = await createUser({ isActive: false });
    const res = await login({ employeeCode: user.employeeCode, password: user.password });
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
  });

  it('validates the request body', async () => {
    const res = await login({ employeeCode: '' });
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['employeeCode', 'password']));
  });
});

describe('temporary password', () => {
  it('blocks the app until the password is changed, then ends other sessions', async () => {
    const user = await createUser({ roles: [{ roleCode: 'AUDITOR' }], mustChangePassword: true });
    const agent = await signIn(user);
    const other = await signIn(user);

    const blocked = await agent.get('/api/v1/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await agent.post('/api/v1/auth/change-password').send({ currentPassword: user.password, newPassword: 'short' });
    expect(weak.status).toBe(422);
    const withCode = await agent.post('/api/v1/auth/change-password').send({ currentPassword: user.password, newPassword: `${user.employeeCode}x12345` });
    expect(withCode.body.message).toBe('The password must not contain your employee code.');
    const wrongCurrent = await agent.post('/api/v1/auth/change-password').send({ currentPassword: 'nope-nope-1', newPassword: 'BrandNewPass2026' });
    expect(wrongCurrent.body.errors[0].path).toBe('currentPassword');

    const changed = await agent.post('/api/v1/auth/change-password').send({ currentPassword: user.password, newPassword: 'BrandNewPass2026' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.mustChangePassword).toBe(false);
    expect((await agent.get('/api/v1/users')).status).toBe(200);

    // The other device's access token carries the old token version.
    expect((await other.get('/api/v1/auth/me')).status).toBe(401);
    expect((await other.post('/api/v1/auth/refresh')).status).toBe(401);
  });
});

describe('refresh tokens', () => {
  it('rotates the refresh token on every use', async () => {
    const user = await createUser();
    const agent = await signIn(user);
    const res = await agent.post('/api/v1/auth/refresh');
    expect(res.status).toBe(200);
    expect(cookieValue(res, 'qmas_rt')).toBeTruthy();
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('treats reuse of a rotated token as theft and ends the whole sign-in', async () => {
    const user = await createUser();
    const first = await api().post('/api/v1/auth/login').send({ employeeCode: user.employeeCode, password: user.password });
    const oldToken = cookieValue(first, 'qmas_rt');
    const rotated = await api().post('/api/v1/auth/refresh').set('Cookie', `qmas_rt=${oldToken}`);
    const newToken = cookieValue(rotated, 'qmas_rt');

    // A quick second use is a harmless two-tab race...
    const race = await api().post('/api/v1/auth/refresh').set('Cookie', `qmas_rt=${oldToken}`);
    expect(race.body.code).toBe('REFRESH_RACE');

    // ...but a later reuse revokes the family, including the newest token.
    await getPool().query("UPDATE core.refresh_token SET revoked_at = now() - interval '5 minutes' WHERE token_hash = $1", [hashToken(oldToken)]);
    const reuse = await api().post('/api/v1/auth/refresh').set('Cookie', `qmas_rt=${oldToken}`);
    expect(reuse.status).toBe(401);
    const afterTheft = await api().post('/api/v1/auth/refresh').set('Cookie', `qmas_rt=${newToken}`);
    expect(afterTheft.status).toBe(401);
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM audit.auth_event WHERE user_id = $1 AND event = 'REFRESH_REUSE'", [user.id]);
    expect(rows[0].n).toBe(1);
  });

  it('logout revokes the refresh token and clears cookies', async () => {
    const user = await createUser();
    const agent = request.agent(getApp());
    const res = await agent.post('/api/v1/auth/login').send({ employeeCode: user.employeeCode, password: user.password });
    const rt = cookieValue(res, 'qmas_rt');
    const out = await agent.post('/api/v1/auth/logout');
    expect(out.status).toBe(204);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', `qmas_rt=${rt}`)).status).toBe(401);
  });

  it('rejects forged or missing access tokens', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set('Cookie', 'qmas_at=not.a.jwt')).status).toBe(401);
  });
});
