// Checks the mail settings in .env by logging in to the SMTP server. Sends no mail.
//   npm run check-mail
import { getEnv } from '../src/config/env.js';
import { verifyMailTransport } from '../src/modules/notifications/mailer.js';

try {
  const env = getEnv();
  const r = await verifyMailTransport();
  console.log(r.transport === 'smtp'
    ? `SMTP login OK (${r.host}:${env.SMTP_PORT}, from ${env.MAIL_FROM})${env.MAIL_REDIRECT_TO ? `; all mail redirected to ${env.MAIL_REDIRECT_TO}` : ''}`
    : 'MAIL_TRANSPORT is "log": mail is logged, not sent.');
} catch (err) {
  console.error(`Mail check failed: ${err.message}`);
  process.exitCode = 1;
}
