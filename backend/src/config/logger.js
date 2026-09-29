import { createWriteStream, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

const DEFAULT_LOG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../logs');

// The calendar day on this machine (YYYY-MM-DD), so a new file starts at local midnight.
const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');

/** 'api' for the API server, 'worker' for the background worker (names the log files). */
export const processName = () => (/worker/i.test(path.basename(process.argv[1] ?? '')) ? 'worker' : 'api');

/**
 * One log file per day (`<name>-YYYY-MM-DD.log`) in `dir`, JSON lines like stdout. When the day
 * changes it switches file and deletes files older than `keepDays`. Used where there is no log
 * collector (a plant server, a developer PC); in AWS the logs go to CloudWatch from stdout instead.
 */
export class DailyFileStream {
  constructor({ dir, name, keepDays = 14 }) {
    this.dir = dir;
    this.name = name;
    this.keepDays = keepDays;
    this.day = null;
    this.out = null;
    mkdirSync(dir, { recursive: true });
  }

  file(day) {
    return path.join(this.dir, `${this.name}-${day}.log`);
  }

  write(line) {
    const day = localDay();
    if (day !== this.day) {
      this.out?.end();
      this.day = day;
      this.out = createWriteStream(this.file(day), { flags: 'a' });
      this.out.on('error', () => {}); // a full or locked disk must never stop the app
      this.prune(day);
    }
    this.out.write(line);
  }

  prune(today) {
    const [y, m, d] = today.split('-').map(Number);
    const oldest = localDay(new Date(y, m - 1, d - (this.keepDays - 1)));
    const pattern = new RegExp(`^${this.name}-(\\d{4}-\\d{2}-\\d{2})\\.log$`);
    try {
      for (const f of readdirSync(this.dir)) {
        const hit = pattern.exec(f);
        if (hit && hit[1] < oldest) unlinkSync(path.join(this.dir, f));
      }
    } catch {
      /* pruning is best effort */
    }
  }
}

/**
 * JSON logs to stdout (collected by CloudWatch in AWS) and, unless LOG_TO_FILE=false, to daily
 * files in LOG_DIR (default backend/logs, kept LOG_FILE_DAYS days). Secrets and cookies are redacted.
 */
export function createLogger(level = process.env.LOG_LEVEL ?? 'info') {
  const name = processName();
  const toFile = process.env.NODE_ENV !== 'test' && process.env.LOG_TO_FILE !== 'false';
  const streams = [{ level, stream: process.stdout }];
  if (toFile) {
    try {
      const dir = path.resolve(process.env.LOG_DIR || DEFAULT_LOG_DIR);
      streams.push({ level, stream: new DailyFileStream({ dir, name, keepDays: Number(process.env.LOG_FILE_DAYS) || 14 }) });
    } catch {
      /* no writable log folder: stdout only */
    }
  }
  return pino(
    {
      level,
      base: { service: `qmas-${name}` },
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
    },
    pino.multistream(streams),
  );
}

export const logger = createLogger();
