import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv, setEnv } from '../src/config/env.js';
import { getPool } from '../src/db/pool.js';
import { setClaudeClient } from '../src/modules/ai/claude.js';
import { setPuterClient } from '../src/modules/ai/puter.js';
import { agentWithRoles, plantId } from './helpers.js';
import { imirAct, inspector, ok, submittedLot } from './lots.js';

const A = {};
let lot;
const baseEnv = getEnv();

/**
 * A stand-in for Claude: records each request and answers from `script`, one entry per call:
 * { parsed } for structured answers, or { content, stop_reason } for chat turns.
 */
function fakeClaude(script) {
  const calls = [];
  const next = (params) => {
    calls.push(params);
    const s = script.shift();
    if (!s) throw new Error('Unexpected call to Claude');
    return typeof s === 'function' ? s(params) : s;
  };
  const usage = { input_tokens: 100, output_tokens: 50 };
  return {
    calls,
    client: {
      messages: {
        parse: async (params) => ({ stop_reason: 'end_turn', usage, content: [], parsed_output: next(params).parsed }),
        create: async (params) => ({ stop_reason: 'end_turn', usage, ...next(params) }),
      },
    },
  };
}
const useClaude = (script) => {
  const fake = fakeClaude(script);
  setEnv({ ...baseEnv, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'claude-opus-5' });
  setClaudeClient(fake.client);
  return fake;
};

beforeAll(async () => {
  const p = await plantId('1115');
  A.inspector = (await inspector()).agent;
  A.incharge = (await agentWithRoles([{ roleCode: 'IQC_INCHARGE', plantId: p }])).agent;
  A.scm = (await agentWithRoles([{ roleCode: 'SCM_REQUESTOR', plantId: p }])).agent;
  lot = await submittedLot(A.inspector);
  ok(await imirAct(A.incharge, lot.id, { action: 'escalate', remark: 'Dia over size' }));
});
afterAll(() => {
  setEnv(baseEnv);
  setClaudeClient(null);
  setPuterClient(null);
});

describe('quality insights (no AI)', () => {
  it('gives every viewer the lot history and supplier risk; the failure chance only to Incharge and above', async () => {
    const seen = ok(await A.inspector.get(`/api/v1/insights/imirs/${lot.id}`));
    expect(seen.supplier).toMatchObject({ vendorCode: 'V100', level: expect.any(String), recommendation: expect.any(String) });
    expect(Object.keys(seen.checkpoints)).toHaveLength(lot.checkpoints.length);
    expect(seen.prediction).toBeNull();
    const byIncharge = ok(await A.incharge.get(`/api/v1/insights/imirs/${lot.id}`));
    expect(byIncharge.prediction.probability).toBeGreaterThan(0);
    expect((await A.scm.get(`/api/v1/insights/overview`)).status).toBe(403);
    const o = ok(await A.incharge.get('/api/v1/insights/overview'));
    expect(o.vendors.some((v) => v.vendorCode === 'V100')).toBe(true);
  });
});

describe('AI features', () => {
  it('says clearly when AI is not set up', async () => {
    setEnv({ ...baseEnv, ANTHROPIC_API_KEY: undefined });
    setClaudeClient(null);
    expect(ok(await A.incharge.get('/api/v1/ai/status'))).toEqual({ configured: false, provider: null, model: null });
    const r = await A.incharge.post(`/api/v1/ai/imirs/${lot.id}/summary`).send({});
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('AI_NOT_CONFIGURED');
  });

  it('summarises an inspection once, reuses it while nothing changes, and regenerates on request', async () => {
    const answer = { parsed: { summary: 'Lot failed on Dia.', highlights: [{ text: 'Dia 10.2 mm over 10.1', tone: 'bad' }] } };
    const fake = useClaude([answer, answer]);
    const first = ok(await A.incharge.post(`/api/v1/ai/imirs/${lot.id}/summary`).send({}));
    expect(first).toMatchObject({ summary: 'Lot failed on Dia.', meta: { cached: false, model: 'claude-opus-5' } });
    expect(fake.calls[0].messages[0].content).toContain(lot.imirNo);
    expect(fake.calls[0].output_config.format.type).toBe('json_schema');
    expect(ok(await A.incharge.post(`/api/v1/ai/imirs/${lot.id}/summary`).send({})).meta.cached).toBe(true);
    ok(await A.incharge.post(`/api/v1/ai/imirs/${lot.id}/summary`).send({ refresh: true }));
    expect(fake.calls).toHaveLength(2);
    expect((await A.inspector.post(`/api/v1/ai/imirs/${lot.id}/summary`).send({})).status).toBe(403); // Incharge and above
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM core.ai_call WHERE feature = 'IMIR_SUMMARY' AND ok");
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('turns a question into list filters and drops anything the list cannot filter on', async () => {
    const fake = useClaude([{
      parsed: {
        target: 'imirs', mode: 'all', explanation: 'Not OK lots from vendor V100',
        rules: [{ field: 'result', op: 'in', value: ['NOK'] }, { field: 'vendorCode', op: 'equals', value: 'V100' }, { field: 'password', op: 'equals', value: 'x' }],
        unsupported: null,
      },
    }]);
    const r = ok(await A.incharge.post('/api/v1/ai/search').send({ q: 'failed lots from V100' }));
    expect(r.filter.rules).toEqual([{ field: 'result', op: 'in', value: ['NOK'] }, { field: 'vendorCode', op: 'equals', value: 'V100' }]);
    expect(r.dropped).toHaveLength(1);
    expect(fake.calls[0].system).toContain('vendorCode');
  });

  it('answers chat questions from the data through tools, within the user\'s plants', async () => {
    const fake = useClaude([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'find_records', input: { target: 'imirs', filter: { rules: [{ field: 'imirNo', op: 'equals', value: lot.imirNo }] } } }] },
      (params) => ({ content: [{ type: 'text', text: `Found it: ${JSON.parse(params.messages.at(-1).content[0].content).total} lot.` }] }),
    ]);
    const r = ok(await A.incharge.post('/api/v1/ai/chat').send({ messages: [{ role: 'user', content: `Show ${lot.imirNo}` }] }));
    expect(r).toEqual({ reply: 'Found it: 1 lot.', toolCalls: ['find_records'] });
    expect(fake.calls[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect((await A.incharge.post('/api/v1/ai/chat').send({ messages: [{ role: 'assistant', content: 'hi' }] })).status).toBe(422);
  });

  it('assesses a CAPA against the five elements and suggests root causes from past cases', async () => {
    const dn = ok(await A.incharge.post('/api/v1/dns').send({ imirId: lot.id }));
    const cur = ok(await A.incharge.get(`/api/v1/dns/${dn.id}`));
    ok(await A.incharge.post(`/api/v1/dns/${dn.id}/actions`).send({
      rowVersion: cur.rowVersion, action: 'submit_capa',
      capa: { rootCause: 'Operator mistake', correctiveAction: 'Operator trained', targetDate: '2026-10-15', responsibility: 'Vendor QA' },
    }));
    const fake = useClaude([
      { parsed: { overall: 'INADEQUATE', summary: 'Root cause is not specific.', elements: [{ element: 'ROOT_CAUSE', rating: 'WEAK', finding: 'Operator mistake is a symptom.' }], repetitive: { isRepetitive: false, similarTo: [], note: '' }, askVendor: ['Why did the operator make the mistake?'] } },
      { parsed: { causes: [{ cause: 'Tool wear', likelihood: 'MEDIUM', reasoning: 'Oversize dia', basedOn: [] }], actions: [{ action: 'Re-grind tool', type: 'CORRECTIVE', basedOn: [] }], caution: 'Verify with the vendor.' } },
    ]);
    const a = ok(await A.incharge.post(`/api/v1/ai/dns/${dn.id}/capa-assessment`).send({}));
    expect(a).toMatchObject({ overall: 'INADEQUATE', cycleNo: 1 });
    expect(a.elements.map((e) => e.element)).toEqual(['ROOT_CAUSE', 'CONTAINMENT', 'CORRECTIVE_ACTION', 'PREVENTIVE_ACTION', 'EFFECTIVENESS_EVIDENCE']);
    expect(a.elements[1]).toMatchObject({ rating: 'MISSING' }); // filled in when the answer skipped it
    expect(fake.calls[0].messages[0].content).toContain('Root cause: Operator mistake');
    const rc = ok(await A.incharge.post(`/api/v1/ai/dns/${dn.id}/root-cause`).send({}));
    expect(rc.causes[0].cause).toBe('Tool wear');
    expect(fake.calls[1].messages[0].content).toContain(dn.dnNo);
  });

  it('tidies a dictated observation for inspectors only', async () => {
    useClaude([{ parsed: { text: 'Burr on edge, 0.3 mm high', values: [0.3] } }]);
    expect(ok(await A.inspector.post('/api/v1/ai/observations/tidy').send({ text: 'burr on edge zero point three mm high', checkpoint: 'Aesthetic' }))).toEqual({ text: 'Burr on edge, 0.3 mm high', values: [0.3] });
    expect((await A.scm.post('/api/v1/ai/observations/tidy').send({ text: 'x' })).status).toBe(403);
  });

  it('runs the same features through Puter for a trial, translating its tool format', async () => {
    const calls = [];
    const script = [
      () => ({ message: { content: '{"summary":"Trial summary.","highlights":[]}' }, finish_reason: 'stop' }),
      () => ({ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find_records', arguments: JSON.stringify({ target: 'imirs', filter: { rules: [{ field: 'imirNo', op: 'equals', value: lot.imirNo }] } }) } }] }, finish_reason: 'tool_calls' }),
      (msgs) => ({ message: { content: `Total ${JSON.parse(msgs.at(-1).content).total}` }, finish_reason: 'stop' }),
    ];
    setEnv({ ...baseEnv, AI_PROVIDER: 'puter', PUTER_AUTH_TOKEN: 'trial-token', PUTER_MODEL: 'anthropic/claude-opus-5' });
    setPuterClient({ ai: { chat: async (msgs, _test, opts) => { calls.push({ msgs: [...msgs], opts }); return script.shift()(msgs); } } });
    expect(ok(await A.incharge.get('/api/v1/ai/status'))).toEqual({ configured: true, provider: 'puter', model: 'anthropic/claude-opus-5' });

    const sum = ok(await A.incharge.post(`/api/v1/ai/imirs/${lot.id}/summary`).send({ refresh: true }));
    expect(sum.summary).toBe('Trial summary.');
    expect(calls[0].msgs[0]).toMatchObject({ role: 'system' });
    expect(calls[0].msgs[0].content).toContain('JSON schema');
    expect(calls[0].opts.model).toBe('anthropic/claude-opus-5');

    const r = ok(await A.incharge.post('/api/v1/ai/chat').send({ messages: [{ role: 'user', content: 'find it' }] }));
    expect(r).toEqual({ reply: 'Total 1', toolCalls: ['find_records'] });
    expect(calls[1].opts.tools[0]).toMatchObject({ type: 'function', function: { name: 'find_records' } });
    expect(calls[2].msgs.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });

    setPuterClient({ ai: { chat: async () => { throw { error: { message: 'Unauthorized: invalid token' } }; } } });
    const bad = await A.incharge.post(`/api/v1/ai/imirs/${lot.id}/summary`).send({ refresh: true });
    expect(bad.status).toBe(502);
    expect(bad.body.message).toContain('puter-login');
    setPuterClient(null);
    setEnv({ ...baseEnv, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'claude-opus-5' });
  });

  it('turns a refusal or an unreachable service into a clear message', async () => {
    const fake = fakeClaude([]);
    fake.client.messages.parse = async () => ({ stop_reason: 'refusal', content: [], usage: {} });
    setClaudeClient(fake.client);
    const r = await A.incharge.post(`/api/v1/ai/imirs/${lot.id}/summary`).send({ refresh: true });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('AI_REFUSED');
  });
});
