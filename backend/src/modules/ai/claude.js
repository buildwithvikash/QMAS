import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { AppError } from '../../shared/AppError.js';
import { puterClient, puterError, puterText, puterUsage, toPuterTools } from './puter.js';

/**
 * The one place QMAS talks to Claude. Two providers, chosen with AI_PROVIDER:
 *   anthropic — the Anthropic API (ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL); for live use.
 *   puter     — Claude through Puter (PUTER_AUTH_TOKEN, PUTER_MODEL); a trial on demo data only.
 * Every call is logged to core.ai_call (feature, user, tokens, time, outcome); failures become
 * clear messages. Keys and tokens are never logged.
 */

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_PUTER_MODEL = 'anthropic/claude-opus-5';
let client = null;

export function aiProvider() {
  const env = getEnv();
  return env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.PUTER_AUTH_TOKEN ? 'puter' : 'anthropic');
}
export const aiConfigured = () => Boolean(aiProvider() === 'puter' ? getEnv().PUTER_AUTH_TOKEN : getEnv().ANTHROPIC_API_KEY);
export const aiModel = () => (aiProvider() === 'puter' ? getEnv().PUTER_MODEL ?? DEFAULT_PUTER_MODEL : getEnv().ANTHROPIC_MODEL ?? DEFAULT_MODEL);

function requireConfigured() {
  if (aiConfigured()) return;
  const what = aiProvider() === 'puter' ? 'PUTER_AUTH_TOKEN (run "npm run puter-login")' : 'ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL, ANTHROPIC_MODEL)';
  throw new AppError(503, `AI is not set up on this server yet. The administrator adds ${what} to the server settings.`, { code: 'AI_NOT_CONFIGURED' });
}

function sdk() {
  requireConfigured();
  const env = getEnv();
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL?.replace(/\/$/, ''), timeout: 120_000, maxRetries: 2 });
  return client;
}

/** Tests: use a stand-in client (same messages.create / messages.parse surface). */
export function setClaudeClient(c) {
  client = c;
}

// A few calls a minute per person is plenty for this app; this stops runaway loops and double clicks.
const WINDOW_MS = 10 * 60_000;
const MAX_CALLS = 40;
const recent = new Map();
function throttle(userId) {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_CALLS) throw new AppError(429, 'You have used the AI a lot in the last few minutes. Please wait a little and try again.', { code: 'AI_BUSY' });
  list.push(now);
  recent.set(userId, list);
}

async function log(feature, userId, model, started, usage, error = null) {
  await getPool()
    .query(
      'INSERT INTO core.ai_call (user_id, feature, model, input_tokens, output_tokens, duration_ms, ok, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [userId ?? null, feature, model, usage?.input_tokens ?? null, usage?.output_tokens ?? null, Date.now() - started, !error, error ? String(error).slice(0, 500) : null],
    )
    .catch(() => {}); // logging must never fail the request
}

/** SDK errors as messages people can act on. */
function toAppError(err) {
  if (err instanceof AppError) return err;
  if (aiProvider() === 'puter') return puterError(err);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AppError(502, 'The AI service refused the API key. Check ANTHROPIC_API_KEY in the server settings.', { code: 'AI_UNAVAILABLE' });
  }
  if (err instanceof Anthropic.NotFoundError) return new AppError(502, `The AI service does not know the model "${aiModel()}". Check ANTHROPIC_MODEL.`, { code: 'AI_UNAVAILABLE' });
  if (err instanceof Anthropic.RateLimitError) return new AppError(503, 'The AI service is busy. Please try again in a minute.', { code: 'AI_UNAVAILABLE' });
  if (err instanceof Anthropic.APIConnectionError) return new AppError(502, 'The AI service could not be reached. Check the connection and ANTHROPIC_BASE_URL.', { code: 'AI_UNAVAILABLE' });
  if (err instanceof Anthropic.APIError) return new AppError(502, `The AI service returned an error (HTTP ${err.status ?? '?'}). Please try again.`, { code: 'AI_UNAVAILABLE' });
  return err;
}

const unreadable = () => new AppError(502, 'The AI answer could not be read. Please try again.', { code: 'AI_UNAVAILABLE' });

function checkStop(response) {
  if (response.stop_reason === 'refusal') throw new AppError(422, 'The AI declined to answer this request.', { code: 'AI_REFUSED' });
  if (response.stop_reason === 'max_tokens') throw new AppError(502, 'The AI answer was cut off. Please try again.', { code: 'AI_UNAVAILABLE' });
}

const textOf = (response) => response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
const jsonInstruction = (schema) => `\n\nReply with a single JSON object only, no prose and no code fences, matching this JSON schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;

/** A JSON answer given as text, checked against the schema. */
function parseJson(text, schema) {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = t.indexOf('{');
  if (start < 0) throw unreadable();
  let data;
  try {
    data = JSON.parse(t.slice(start, t.lastIndexOf('}') + 1));
  } catch {
    throw unreadable();
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new AppError(502, 'The AI answer was not in the expected form. Please try again.', { code: 'AI_UNAVAILABLE' });
  return result.data;
}

async function anthropicStructured({ system, prompt, schema, maxTokens, model }) {
  const anthropic = sdk();
  try {
    const response = await anthropic.messages.parse({
      model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: zodOutputFormat(schema) },
    });
    checkStop(response);
    if (!response.parsed_output) throw unreadable();
    return { parsed: response.parsed_output, usage: response.usage };
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    // Structured outputs not accepted here (some gateways): ask for plain JSON and check it ourselves.
    const response = await anthropic.messages.create({ model, max_tokens: maxTokens, system: system + jsonInstruction(schema), messages: [{ role: 'user', content: prompt }] });
    checkStop(response);
    return { parsed: parseJson(textOf(response), schema), usage: response.usage };
  }
}

async function puterStructured({ system, prompt, schema, maxTokens, model }) {
  const puter = await puterClient(getEnv().PUTER_AUTH_TOKEN);
  const res = await puter.ai.chat([{ role: 'system', content: system + jsonInstruction(schema) }, { role: 'user', content: prompt }], false, { model, max_tokens: maxTokens, normalize: true });
  if (res?.finish_reason === 'length') throw new AppError(502, 'The AI answer was cut off. Please try again.', { code: 'AI_UNAVAILABLE' });
  return { parsed: parseJson(puterText(res), schema), usage: puterUsage(res) };
}

/**
 * One question, one structured answer validated against `schema` (Zod). Anthropic: structured
 * outputs (plain JSON as a fallback). Puter: JSON by instruction, checked here.
 */
export async function askStructured({ feature, userId, system, prompt, schema, maxTokens = 4000 }) {
  requireConfigured();
  throttle(userId);
  const model = aiModel();
  const started = Date.now();
  try {
    const run = aiProvider() === 'puter' ? puterStructured : anthropicStructured;
    const { parsed, usage } = await run({ system, prompt, schema, maxTokens, model });
    await log(feature, userId, model, started, usage);
    return { output: parsed, model };
  } catch (err) {
    const e = toAppError(err);
    await log(feature, userId, model, started, null, e.message);
    throw e;
  }
}

async function runTools(calls, runTool, toolCalls) {
  const out = [];
  for (const { id, name, input } of calls) {
    toolCalls.push({ name, input });
    try {
      out.push({ id, ok: true, content: JSON.stringify(await runTool(name, input)) });
    } catch (err) {
      out.push({ id, ok: false, content: err instanceof AppError ? err.message : 'The query failed.' });
    }
  }
  return out;
}

async function anthropicChat({ system, messages, tools, runTool, maxTurns, maxTokens, model, usage, toolCalls }) {
  const anthropic = sdk();
  const convo = [...messages];
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await anthropic.messages.create({ model, max_tokens: maxTokens, system, tools, messages: convo });
    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;
    checkStop(response);
    if (response.stop_reason !== 'tool_use') return textOf(response);
    convo.push({ role: 'assistant', content: response.content });
    const calls = response.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const results = await runTools(calls, runTool, toolCalls);
    // All results of one turn go back in one message.
    convo.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.ok ? {} : { is_error: true }) })) });
  }
  return null;
}

async function puterChat({ system, messages, tools, runTool, maxTurns, maxTokens, model, usage, toolCalls }) {
  const puter = await puterClient(getEnv().PUTER_AUTH_TOKEN);
  const convo = [{ role: 'system', content: system }, ...messages];
  const puterTools = toPuterTools(tools);
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const res = await puter.ai.chat(convo, false, { model, max_tokens: maxTokens, tools: puterTools, normalize: true });
    const u = puterUsage(res);
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
    const calls = res?.message?.tool_calls ?? [];
    if (!calls.length) {
      if (res?.finish_reason === 'length') throw new AppError(502, 'The AI answer was cut off. Please try again.', { code: 'AI_UNAVAILABLE' });
      return puterText(res);
    }
    convo.push({ role: 'assistant', content: puterText(res), tool_calls: calls });
    const parsed = calls.map((c) => {
      let input = {};
      try {
        input = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function?.arguments ?? {};
      } catch { /* bad arguments: the tool reports what is missing */ }
      return { id: c.id, name: c.function?.name, input };
    });
    const results = await runTools(parsed, runTool, toolCalls);
    for (const r of results) convo.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
  return null;
}

/**
 * A conversation turn with tools: Claude may call `tools` (Anthropic format; run by
 * `runTool(name, input)`, which returns JSON-able data) until it answers. Returns { text, toolCalls }.
 */
export async function chatWithTools({ feature, userId, system, messages, tools, runTool, maxTurns = 8, maxTokens = 4000 }) {
  requireConfigured();
  throttle(userId);
  const model = aiModel();
  const started = Date.now();
  const usage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls = [];
  try {
    const run = aiProvider() === 'puter' ? puterChat : anthropicChat;
    const text = await run({ system, messages, tools, runTool, maxTurns, maxTokens, model, usage, toolCalls });
    if (text === null) throw new AppError(502, 'The question needed too many steps. Try asking something more specific.', { code: 'AI_UNAVAILABLE' });
    await log(feature, userId, model, started, usage);
    return { text, toolCalls };
  } catch (err) {
    const e = toAppError(err);
    await log(feature, userId, model, started, usage, e.message);
    throw e;
  }
}
