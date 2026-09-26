import { AppError } from '../../shared/AppError.js';

/**
 * Trial provider: Claude through Puter (puter.com), for testing the AI features on demo data
 * before a company Anthropic key is set up. Signs in with a Puter account token (PUTER_AUTH_TOKEN,
 * from `npm run puter-login`). Puter speaks the OpenAI message and tool format, so requests and
 * answers are translated here; the rest of QMAS sees the same results as with Anthropic.
 * Not for real company data: requests pass through Puter's servers.
 */

let puter = null;

/** The puter.js client for this token (its Node build runs in its own sandbox; loaded on first use). */
export async function puterClient(token) {
  if (puter) return puter;
  const { init } = (await import('@heyputer/puter.js/src/init.cjs')).default;
  puter = init(token);
  return puter;
}

/** Tests: use a stand-in client with the same ai.chat surface. */
export function setPuterClient(c) {
  puter = c;
}

/** Answer text, whether Puter returns a string or content blocks. */
export function puterText(res) {
  const c = res?.message?.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) return c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
  return '';
}

export function puterUsage(res) {
  const u = res?.usage ?? {};
  return { input_tokens: u.input_tokens ?? u.prompt_tokens ?? 0, output_tokens: u.output_tokens ?? u.completion_tokens ?? 0 };
}

/** Puter failures as messages people can act on. */
export function puterError(err) {
  if (err instanceof AppError) return err;
  const msg = String(err?.error?.message ?? err?.message ?? err?.error ?? err ?? '');
  if (/auth|token|unauthori|forbidden|sign.?in/i.test(msg)) {
    return new AppError(502, 'Puter refused the sign-in. Run "npm run puter-login" again to get a fresh PUTER_AUTH_TOKEN.', { code: 'AI_UNAVAILABLE' });
  }
  if (/insufficient|funds|credit|quota|usage.?limit|exceeded/i.test(msg)) {
    return new AppError(503, 'The Puter account has used up its AI allowance. Try again later or use another Puter account.', { code: 'AI_UNAVAILABLE' });
  }
  if (/model/i.test(msg)) return new AppError(502, `Puter did not accept the model. Check PUTER_MODEL (for example anthropic/claude-opus-5). ${msg.slice(0, 160)}`, { code: 'AI_UNAVAILABLE' });
  return new AppError(502, `The AI service (Puter) returned an error${msg ? `: ${msg.slice(0, 200)}` : ''}. Please try again.`, { code: 'AI_UNAVAILABLE' });
}

/** Anthropic-style tool definitions ({ name, description, input_schema }) in Puter's format. */
export const toPuterTools = (tools) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
