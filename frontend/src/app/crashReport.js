/**
 * Sends a crash in the browser to the server's error log (Administration → Error Log).
 * Plain fetch (not RTK Query) so it still works when the app's state is what broke. At most a few
 * reports per page load and never the same message twice; failures are ignored.
 */
const sent = new Set();
let count = 0;
const MAX_PER_LOAD = 8;
// Browser noise that is not a fault in QMAS.
const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /Non-Error promise rejection captured/i];

export async function reportCrash({ message, stack, componentStack, kind = 'error' }) {
  const text = String(message ?? 'Unknown error').slice(0, 1000);
  if (!text || IGNORE.some((r) => r.test(text))) return null;
  const key = `${kind}:${text}`;
  if (sent.has(key) || count >= MAX_PER_LOAD) return null;
  sent.add(key);
  count += 1;
  try {
    const res = await fetch('/api/v1/system/client-errors', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        stack: stack ? String(stack).slice(0, 8000) : undefined,
        componentStack: componentStack ? String(componentStack).slice(0, 8000) : undefined,
        page: `${window.location.pathname}${window.location.search}`.slice(0, 500),
        kind,
        appVersion: import.meta.env.VITE_APP_VERSION || undefined,
      }),
    });
    if (!res.ok) return null;
    return (await res.json()).data?.reference ?? null;
  } catch {
    return null;
  }
}

/** Uncaught errors and rejected promises anywhere in the page (installed once, in main.jsx). */
export function installCrashReporting() {
  window.addEventListener('error', (e) => {
    // Failed <img>/<script> loads also fire 'error' without an Error object: not crashes.
    if (!e.error && !e.message) return;
    reportCrash({ message: e.error?.message ?? e.message, stack: e.error?.stack, kind: 'error' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // Aborted requests and RTK Query's handled errors are not crashes.
    if (r?.name === 'AbortError' || (r && typeof r === 'object' && 'status' in r && 'data' in r)) return;
    reportCrash({ message: r?.message ?? String(r), stack: r?.stack, kind: 'rejection' });
  });
}
