import { getPool } from '../../db/pool.js';
import { registerAttachmentRenderer } from '../notifications/mailer.js';
import { renderDnPdf } from './dn.pdf.js';
import { detail } from './dn.service.js';

// "Mail to myself" attaches the DN as a PDF, rendered when the mail is sent (API or worker).
registerAttachmentRenderer('DN_PDF', async ({ id }) => {
  const dn = await detail(id, null);
  return { filename: `${dn.dnNo}.pdf`, content: await renderDnPdf(dn, getPool()), contentType: 'application/pdf' };
});
