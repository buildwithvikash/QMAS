import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DailyFileStream } from '../src/config/logger.js';
import { getPool } from '../src/db/pool.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { recordError } from '../src/modules/system/errorLog.js';
import { checkAlerts } from '../src/modules/system/system.service.js';
import { adminAgent, agentWithRoles, uid } from './helpers.js';

const ok = (res) => {
  if (res.status >= 300) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};

let admin;
let user;

beforeAll(async () => {
  admin = await adminAgent();
  user = await agentWithRoles([{ roleCode: 'SCM_REQUESTOR' }]);
});

describe('system health and error log', () => {
  it('shows health to monitoring users only', async () => {
    expect((await user.agent.get('/api/v1/system/health')).status).toBe(403);
    const h = ok(await admin.agent.get('/api/v1/system/health'));
    expect(['OK', 'WARNING', 'DOWN']).toContain(h.status);
    expect(h.database.ok).toBe(true);
    expect(h.api.version).toBeTruthy();
    expect(h.mail).toHaveProperty('pending');
    expect(Array.isArray(h.problems)).toBe(true);
  });

  it('logs browser crashes from any user, grouped, and reopens them when they come back', async () => {
    const message = `Cannot read properties of undefined (reading 'x${uid()}')`;
    const first = ok(await user.agent.post('/api/v1/system/client-errors').send({ message, page: '/imirs/123', kind: 'render', stack: 'TypeError\n    at Sheet (Sheet.jsx:10:5)' }));
    expect(first.logged).toBe(true);
    expect(first.reference).toHaveLength(8);
    ok(await user.agent.post('/api/v1/system/client-errors').send({ message, page: '/imirs/456', kind: 'render', stack: 'TypeError\n    at Sheet (Sheet.jsx:10:5)' }));

    const list = ok(await admin.agent.get(`/api/v1/system/errors?source=CLIENT&q=${encodeURIComponent(message.slice(-14, -2))}`));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: 'CLIENT', occurrences: 2, userCode: user.user.employeeCode });
    expect(list[0].message).toContain('Page crashed');

    const resolved = ok(await admin.agent.post(`/api/v1/system/errors/${list[0].id}/resolve`).send({ note: 'Fixed in the sheet' }));
    expect(resolved.resolvedAt).toBeTruthy();
    expect(resolved.resolution).toBe('Fixed in the sheet');
    expect(resolved.fingerprint).toBeUndefined();

    ok(await user.agent.post('/api/v1/system/client-errors').send({ message, page: '/imirs/789', kind: 'render', stack: 'TypeError\n    at Sheet (Sheet.jsx:10:5)' }));
    const again = ok(await admin.agent.get(`/api/v1/system/errors/${list[0].id}`));
    expect(again).toMatchObject({ occurrences: 3, resolvedAt: null, resolution: null });
    expect(again.events.length).toBe(3);

    expect((await user.agent.get('/api/v1/system/errors')).status).toBe(403);
    expect((await user.agent.post('/api/v1/system/client-errors').send({ message: '' })).status).toBe(422);
  });

  it('keeps server 500s with the reference shown to the user, but not validation errors', async () => {
    const sent = {};
    const res = { status: (s) => { sent.status = s; return res; }, json: (b) => { sent.body = b; return res; } };
    const req = { id: `req-${uid()}`, method: 'GET', baseUrl: '/api/v1/test', path: '/boom', route: { path: '/boom' }, user: { id: user.user.id }, get: () => 'vitest', log: { error() {}, warn() {} } };
    errorHandler(new Error(`database exploded ${uid()}`), req, res, () => {});
    expect(sent.status).toBe(500);
    expect(sent.body.code).toBe('INTERNAL');
    await new Promise((r) => setTimeout(r, 300));
    const { rows } = await getPool().query("SELECT source, path, status_code, request_id FROM core.error_log WHERE request_id = $1", [req.id]);
    expect(rows[0]).toMatchObject({ source: 'SERVER', path: '/api/v1/test/boom', status_code: 500 });

    // A 422 is the user's input, not a failure: not logged.
    const before = (await getPool().query('SELECT count(*)::int AS n FROM core.error_log')).rows[0].n;
    expect((await admin.agent.post('/api/v1/support/tickets').send({})).status).toBe(422);
    expect((await getPool().query('SELECT count(*)::int AS n FROM core.error_log')).rows[0].n).toBe(before);
  });

  it('puts failed mail back in the queue', async () => {
    const { rows } = await getPool().query(
      "INSERT INTO core.mail_outbox (to_address, subject, body_text, body_html, status, attempts, last_error) VALUES ('x@example.com', 'test', 't', '<p>t</p>', 'FAILED', 5, 'SMTP refused') RETURNING id",
    );
    const r = ok(await admin.agent.post('/api/v1/system/mail/retry-failed'));
    expect(r.requeued).toBeGreaterThanOrEqual(1);
    const { rows: m } = await getPool().query('SELECT status, attempts FROM core.mail_outbox WHERE id = $1', [rows[0].id]);
    expect(m[0]).toEqual({ status: 'PENDING', attempts: 0 });
  });

  it('alerts monitoring users once when the worker has stopped', async () => {
    const pool = getPool();
    await pool.query('DELETE FROM core.monitor_alert');
    await pool.query(
      `INSERT INTO core.service_heartbeat (component, kind, host, pid, started_at, last_beat)
       VALUES ($1, 'WORKER', 'test', 1, now() - interval '1 hour', now() - interval '10 minutes')`,
      [`worker:test:${uid()}`],
    );
    const first = await checkAlerts();
    expect(first.found).toContain('WORKER_DOWN');
    const { rows } = await pool.query("SELECT 1 FROM core.notification WHERE user_id = $1 AND kind = 'MONITOR_WORKER_DOWN'", [admin.user.id]);
    expect(rows.length).toBe(1);
    const second = await checkAlerts();
    expect(second.sent).toBe(0); // at most once an hour
    await pool.query("DELETE FROM core.service_heartbeat WHERE host = 'test'");

    const h = ok(await admin.agent.get('/api/v1/system/health'));
    expect(h.processes.every((p) => p.host !== 'test')).toBe(true);
  });

  it('never throws when recording fails', async () => {
    expect(await recordError({ source: 'NOT_A_SOURCE', message: 'x' })).toBeNull();
  });
});

describe('daily log files', () => {
  it('writes one file per day and removes files older than the kept days', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'qmas-logs-'));
    writeFileSync(path.join(dir, 'api-2000-01-01.log'), 'old\n');
    writeFileSync(path.join(dir, 'worker-2000-01-01.log'), 'other process\n');
    const s = new DailyFileStream({ dir, name: 'api', keepDays: 14 });
    s.write('{"msg":"hello"}\n');
    const today = new Date().toLocaleDateString('en-CA');
    s.out.end();
    return new Promise((resolve) => s.out.on('finish', () => {
      const files = readdirSync(dir).sort();
      expect(files).toContain(`api-${today}.log`);
      expect(files).not.toContain('api-2000-01-01.log');
      expect(files).toContain('worker-2000-01-01.log'); // only its own files are pruned
      expect(readFileSync(path.join(dir, `api-${today}.log`), 'utf8')).toContain('hello');
      resolve();
    }));
  });
});
