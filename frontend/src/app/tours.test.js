import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS as P } from '@qmas/shared';
import { describe, expect, it } from 'vitest';
import { TOURS, tourFor } from './tours.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const full = path.join(dir, f);
  return statSync(full).isDirectory() ? files(full) : /\.(jsx|js)$/.test(f) && !f.endsWith('.test.js') ? [full] : [];
});
const code = files(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('guided tours', () => {
  it('every step has words, and every data-tour anchor a step points at exists in the app', () => {
    const anchors = new Set([...code.matchAll(/data-tour="([a-z-]+)"/g)].map((m) => m[1]));
    for (const t of TOURS) {
      expect(t.steps.length, t.key).toBeGreaterThan(0);
      for (const s of t.steps) {
        expect(s.title && s.body, `${t.key}: ${s.title}`).toBeTruthy();
        for (const [, name] of (s.target ?? '').matchAll(/data-tour="([a-z-]+)"/g)) expect(anchors.has(name), `${t.key} → ${name}`).toBe(true);
      }
    }
    expect(new Set(TOURS.map((t) => t.key)).size).toBe(TOURS.length);
  });

  it('picks the tour of the page, only for people who may use that page', () => {
    const all = () => true;
    expect(tourFor('/', all)?.key).toBe('welcome');
    expect(tourFor('/imirs', all)?.key).toBe('imir-list');
    expect(tourFor('/imirs/92ff6616-d7f9-456e-b361-1b9d6f8e6ae1', all)?.key).toBe('imir');
    expect(tourFor('/formats/versions/abc/edit', all)?.key).toBe('builder');
    expect(tourFor('/admin/audit', all)).toBeNull();
    const inspector = (perm) => [null, undefined, P.DASHBOARD_VIEW, P.IMIR_VIEW].includes(perm);
    expect(tourFor('/formats/import', inspector)).toBeNull();
    expect(tourFor('/help', inspector)?.key).toBe('help');
  });

  it('tours that need a record say how to start them', () => {
    for (const t of TOURS.filter((x) => !x.startPath)) expect(t.needs, t.key).toBeTruthy();
  });
});
