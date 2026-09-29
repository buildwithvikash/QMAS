import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('crash screen', () => {
  it('shows on a crash and clears when the user moves to another page', async () => {
    const { default: ErrorBoundary } = await import('./ErrorBoundary.jsx');
    const err = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
    const state = { error: err, reference: 'abc12345', key: '/imirs/1' };
    expect(ErrorBoundary.getDerivedStateFromProps({ resetKey: '/imirs/1' }, state)).toBeNull();
    expect(ErrorBoundary.getDerivedStateFromProps({ resetKey: '/dns' }, state)).toEqual({ error: null, reference: null, key: '/dns' });
  });
});

describe('crash reporting', () => {
  let calls;
  beforeEach(() => {
    vi.resetModules();
    calls = [];
    globalThis.window = { location: { pathname: '/imirs/7', search: '?tab=dim' } };
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ data: { reference: 'ref00001' } }) };
    });
  });

  it('sends the crash with the page, once per message, and skips browser noise', async () => {
    const { reportCrash } = await import('../../app/crashReport.js');
    expect(await reportCrash({ message: 'x is undefined', stack: 'at A', kind: 'render' })).toBe('ref00001');
    expect(calls[0].url).toBe('/api/v1/system/client-errors');
    expect(calls[0].body).toMatchObject({ message: 'x is undefined', page: '/imirs/7?tab=dim', kind: 'render' });
    expect(await reportCrash({ message: 'x is undefined', kind: 'render' })).toBeNull(); // same crash again: not re-sent
    expect(await reportCrash({ message: 'ResizeObserver loop completed with undelivered notifications.' })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('stops after a few reports per page load', async () => {
    const { reportCrash } = await import('../../app/crashReport.js');
    for (let i = 0; i < 12; i += 1) await reportCrash({ message: `error ${i}` });
    expect(calls.length).toBe(8);
  });
});
