import { AppError } from '../shared/AppError.js';

// PostgreSQL constraint violations that can reach us despite service-level checks (races,
// direct constraint hits). Mapped to user-facing errors instead of a 500.
const PG_ERRORS = {
  '23505': (err) => AppError.conflict(uniqueMessage(err), { code: 'DUPLICATE' }),
  '23503': () => AppError.conflict('This record is linked to other data and cannot be changed that way.', { code: 'IN_USE' }),
  '23514': () => AppError.unprocessable('A value is outside the allowed range.'),
  '23P01': () => AppError.unprocessable('The values overlap with an existing entry.'),
  '22P02': () => AppError.badRequest('A value has the wrong format.'),
  '40001': () => AppError.conflict('Another change happened at the same time. Please try again.', { code: 'RETRY' }),
  '40P01': () => AppError.conflict('Another change happened at the same time. Please try again.', { code: 'RETRY' }),
};

function uniqueMessage(err) {
  // detail: Key (item_code)=(ABC) already exists.
  const m = /Key \((.+?)\)=\((.+?)\)/.exec(err.detail ?? '');
  if (!m) return 'This record already exists.';
  const field = m[1].replace(/lower\(|upper\(|\)|::\w+/g, '').replace(/_/g, ' ');
  return `${field.charAt(0).toUpperCase()}${field.slice(1)} "${m[2]}" already exists.`;
}

export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`API route ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err;
  if (!(error instanceof AppError)) {
    if (error.code && PG_ERRORS[error.code]) error = PG_ERRORS[error.code](error);
    else if (error.type === 'entity.parse.failed') error = AppError.badRequest('The request body is not valid JSON.');
    else if (error.type === 'entity.too.large') error = new AppError(413, 'The request is too large.');
  }

  const status = error instanceof AppError ? error.statusCode : 500;
  const log = req.log ?? console;
  if (status >= 500) log.error({ err }, 'request failed');
  else if (err !== error) log.warn({ err: { code: err.code, detail: err.detail, constraint: err.constraint } }, error.message);

  // A bug stays hidden behind a reference number; an outside system being down (SAP 502/503,
  // raised on purpose as an AppError) is said as it is, so people know it is not their input.
  const hidden = status >= 500 && !(error instanceof AppError && (status === 502 || status === 503));
  res.status(status).json({
    success: false,
    message: hidden ? 'Something went wrong on the server. Please try again; if it keeps happening, report the reference number.' : error.message,
    code: hidden ? 'INTERNAL' : error.code,
    ...(error.errors && status < 500 ? { errors: error.errors } : {}),
    requestId: req.id,
  });
}
