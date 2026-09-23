import pino from 'pino';

/** JSON logs to stdout (collected by CloudWatch in AWS). Secrets and cookies are redacted. */
export function createLogger(level = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    level,
    base: { service: 'qmas-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.temporaryPassword',
        '*.passwordHash',
        '*.token',
      ],
      censor: '[redacted]',
    },
  });
}

export const logger = createLogger();
