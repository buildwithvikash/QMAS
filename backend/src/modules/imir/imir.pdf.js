import { buildImirForm } from './imir.form.js';

/** Official IMIR print: the review workbook's "Format 2" layout (see imir.form.js), as PDF. */
export async function renderImirPdf(m) {
  return (await buildImirForm(m)).toPdf(`IMIR ${m.imirNo}`);
}

/** The same report as an Excel file. */
export async function renderImirXlsx(m) {
  return (await buildImirForm(m)).toXlsx();
}
