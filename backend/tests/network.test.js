import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { adminAgent, createUser, getApp, signIn } from './helpers.js';

// Requests come from this machine (loopback, a company address); a forwarded address from a
// local proxy stands for a PC outside the company network.
const OUTSIDE = '203.0.113.9';
const HOUR = 3_600_000;

let admin;
let user;
let agent; // the user, signed in from inside

const loginFrom = (ip, u) => request(getApp()).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ employeeCode: u.employeeCode, password: u.password });
const outside = (path) => agent.get(path).set('X-Forwarded-For', OUTSIDE);
const ok = (res) => {
  if (res.status !== 200 && res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};
const grantFor = (userId, { from = -60_000, to = HOUR, reason = 'Site visit at vendor' } = {}) => admin.post('/api/v1/network/grants').send({
  userId, startsAt: new Date(Date.now() + from).toISOString(), endsAt: new Date(Date.now() + to).toISOString(), reason,
});

beforeAll(async () => {
  admin = (await adminAgent()).agent;
  user = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
  agent = await signIn(user);
});

describe('network access control', () => {
  it('works from the company network and says so', async () => {
    expect(ok(await agent.get('/api/v1/network/status'))).toMatchObject({ network: 'COMPANY', enforce: true, externalAccess: null });
  });

  it('refuses sign-in and every request from outside without approved access', async () => {
    const res = await loginFrom(OUTSIDE, user);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EXTERNAL_ACCESS_DENIED');
    expect(res.body.message).toMatch(/only from the company network/);
    const { rows } = await getPool().query(
      "SELECT detail FROM audit.auth_event WHERE user_id = $1 AND event = 'LOGIN_FAILED' ORDER BY id DESC LIMIT 1", [user.id],
    );
    expect(rows[0].detail).toEqual({ reason: 'EXTERNAL_NETWORK' });
    // A session started inside stops working outside.
    const r = await outside('/api/v1/auth/me');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('EXTERNAL_ACCESS_DENIED');
  });

  it('an admin grants access for a period, revokes it, and every grant is kept', async () => {
    const other = await createUser({ roles: [{ roleCode: 'AUDITOR' }] });
    expect((await (await signIn(other)).post('/api/v1/network/grants').send({})).status).toBe(403); // admins only
    expect((await grantFor(user.id, { to: 91 * 24 * HOUR })).status).toBe(422); // at most 90 days
    expect((await grantFor(user.id, { reason: ' ' })).status).toBe(422);

    const g = ok(await grantFor(user.id));
    expect(g).toMatchObject({ userId: user.id, state: 'ACTIVE', reason: 'Site visit at vendor', grantedByName: expect.any(String) });
    expect(ok(await outside('/api/v1/network/status'))).toMatchObject({ network: 'EXTERNAL', externalAccess: { endsAt: g.endsAt } });
    expect((await loginFrom(OUTSIDE, user)).status).toBe(200);
    agent = await signIn(user); // one sign-in at a time: that ended the earlier session

    const list = ok(await admin.get('/api/v1/network/grants').query({ userId: user.id, state: 'ACTIVE' }));
    expect(list.map((x) => x.id)).toContain(g.id);
    const { rows: note } = await getPool().query("SELECT title FROM core.notification WHERE user_id = $1 AND kind = 'ACCESS' ORDER BY id DESC LIMIT 1", [user.id]);
    expect(note[0].title).toBe('External access approved');

    expect((await admin.post(`/api/v1/network/grants/${g.id}/revoke`).send({})).status).toBe(422); // reason required
    const r = ok(await admin.post(`/api/v1/network/grants/${g.id}/revoke`).send({ reason: 'Visit cancelled' }));
    expect(r).toMatchObject({ state: 'REVOKED', revokeReason: 'Visit cancelled', revokedByName: expect.any(String) });
    expect((await outside('/api/v1/auth/me')).status).toBe(403);
    expect((await admin.post(`/api/v1/network/grants/${g.id}/revoke`).send({ reason: 'again' })).status).toBe(409);

    await expect(getPool().query('UPDATE core.external_access_grant SET reason = $2 WHERE id = $1', [g.id, 'changed'])).rejects.toThrow(/cannot be changed/);
    await expect(getPool().query('DELETE FROM core.external_access_grant WHERE id = $1', [g.id])).rejects.toThrow(/cannot be deleted/);
  });

  it('access ends by itself when the approved period is over, and does not start early', async () => {
    const { rows } = await getPool().query(
      "INSERT INTO core.external_access_grant (user_id, starts_at, ends_at, reason, granted_by) VALUES ($1, now() - interval '2 hours', now() - interval '1 hour', 'Past trip', $1) RETURNING id",
      [user.id],
    );
    expect((await outside('/api/v1/auth/me')).status).toBe(403);
    expect(ok(await admin.get('/api/v1/network/grants').query({ userId: user.id, state: 'EXPIRED' })).map((x) => x.id)).toContain(Number(rows[0].id));
    const later = ok(await grantFor(user.id, { from: HOUR, to: 2 * HOUR }));
    expect(later.state).toBe('UPCOMING');
    expect((await outside('/api/v1/auth/me')).status).toBe(403);
  });

  it('the admin sets the company ranges, but cannot shut themselves out', async () => {
    const s = ok(await admin.get('/api/v1/network/settings'));
    expect(s).toMatchObject({ enforce: true, yourNetwork: 'COMPANY' });
    expect(s.internalNetworks).toContain('127.0.0.0/8');
    const bad = await admin.put('/api/v1/network/settings').send({ internalNetworks: ['not a range'], rowVersion: s.rowVersion });
    expect(bad.status).toBe(422);
    const lockout = await admin.put('/api/v1/network/settings').send({ internalNetworks: ['10.0.0.0/8'], rowVersion: s.rowVersion });
    expect(lockout.status).toBe(422);
    expect(lockout.body.message).toMatch(/you would lose access/);

    const wider = ok(await admin.put('/api/v1/network/settings').send({ internalNetworks: [...s.internalNetworks, '203.0.113.0/24'], rowVersion: s.rowVersion }));
    try {
      expect(ok(await outside('/api/v1/network/status')).network).toBe('COMPANY');
    } finally {
      ok(await admin.put('/api/v1/network/settings').send({ internalNetworks: s.internalNetworks, rowVersion: wider.rowVersion }));
    }
    expect((await outside('/api/v1/auth/me')).status).toBe(403);
  });
});
