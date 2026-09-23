/**
 * Expected, user-facing error. `message` is shown to the user as-is, so write it as a sentence
 * that says what went wrong and what to do. Unexpected errors become a generic 500.
 */
export class AppError extends Error {
  constructor(statusCode, message, { code, errors } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code ?? defaultCode(statusCode);
    this.errors = errors;
    this.isOperational = true;
  }

  static badRequest(message, opts) { return new AppError(400, message, opts); }
  static unauthorized(message = 'Please sign in to continue.', opts) { return new AppError(401, message, { code: 'UNAUTHENTICATED', ...opts }); }
  static forbidden(message = 'You do not have permission to do this.', opts) { return new AppError(403, message, opts); }
  static notFound(what = 'Record') { return new AppError(404, `${what} not found.`); }
  static conflict(message, opts) { return new AppError(409, message, opts); }
  static unprocessable(message, errors) { return new AppError(422, message, { code: 'VALIDATION_FAILED', errors }); }
  static staleVersion(what = 'This record') {
    return new AppError(409, `${what} was changed by someone else. Reload it and try again.`, { code: 'STALE_VERSION' });
  }
}

function defaultCode(status) {
  return { 400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'VALIDATION_FAILED', 429: 'TOO_MANY_REQUESTS' }[status] ?? 'ERROR';
}
