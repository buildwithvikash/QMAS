import { AppError } from '../shared/AppError.js';

/** Maps zod issues to [{ path: 'roles.0.plantId', message }] for the UI to place next to fields. */
export const issuesToErrors = (issues) => issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/**
 * Validates and coerces request parts with zod schemas; results go to req.valid.{body,query,params}.
 * Unknown body fields are stripped (zod object default), so clients cannot set columns they should not.
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid ??= {};
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      const errors = issuesToErrors(result.error.issues);
      const message = part === 'body' ? 'Some fields need attention.' : `Invalid ${part === 'query' ? 'filter' : 'address'}: ${errors[0].message}`;
      return next(AppError.unprocessable(message, errors));
    }
    req.valid[part] = result.data;
  }
  next();
};
