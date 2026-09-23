/**
 * Normalises an RTK Query error into { message, fieldErrors, code }.
 * fieldErrors maps a field path (e.g. "roles.0.plantId") to its message, for display next to the field.
 */
export function apiError(err) {
  if (!err) return { message: '', fieldErrors: {}, code: null };
  if (err.status === 'FETCH_ERROR') {
    return { message: 'Cannot reach the server. Check the network connection and try again.', fieldErrors: {}, code: 'NETWORK' };
  }
  const body = err.data ?? {};
  const fieldErrors = {};
  for (const e of body.errors ?? []) fieldErrors[e.path] ??= e.message;
  let message = body.message ?? 'Something went wrong. Please try again.';
  if (body.code === 'INTERNAL' && body.requestId) message = `${message} Reference: ${body.requestId.slice(0, 8)}`;
  return { message, fieldErrors, code: body.code ?? null };
}
