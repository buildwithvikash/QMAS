import { describe, expect, it } from 'vitest';
import { byUrgency, countsByKind, urgencyOf } from './taskUi.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const H = 3_600_000;
const t = (kind, { since = -H, dueAt, sentBack } = {}) => ({ kind, since: new Date(NOW + since).toISOString(), dueAt: dueAt === undefined ? null : new Date(NOW + dueAt).toISOString(), sentBack });

describe('task urgency', () => {
  it('ranks overdue, due today and sent back before waiting work', () => {
    expect(urgencyOf(t('capa', { dueAt: -H }), NOW).level).toBe('overdue');
    expect(urgencyOf(t('deviation', { dueAt: 5 * H }), NOW).level).toBe('due');
    expect(urgencyOf(t('inspect', { sentBack: true }), NOW).level).toBe('due');
    expect(urgencyOf(t('review', { since: -4 * 24 * H }), NOW).level).toBe('stale');
    expect(urgencyOf(t('review', { since: -30 * H }), NOW).level).toBe('waiting');
    expect(urgencyOf(t('review'), NOW).level).toBe('fresh');
    expect(urgencyOf(t('capa', { dueAt: 5 * 24 * H, since: -30 * H }), NOW).level).toBe('waiting'); // deadline far away
  });

  it('counts each kind with its urgent tasks, and sorts most urgent first', () => {
    const list = [t('review', { since: -2 * H }), t('capa', { dueAt: -H }), t('review', { since: -4 * 24 * H }), t('inspect', { sentBack: true })];
    const c = countsByKind(list);
    expect(c.review).toEqual({ total: 2, urgent: 0 });
    expect(c.capa).toEqual({ total: 1, urgent: 1 });
    expect(c.inspect).toEqual({ total: 1, urgent: 1 });
    expect(c.format).toEqual({ total: 0, urgent: 0 });
    expect([...list].sort(byUrgency)[0].kind).toBe('capa');
  });
});
