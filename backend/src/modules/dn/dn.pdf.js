import { buildDnForm } from './dn.form.js';

/** Official DN print: the review workbook's "Defect Notification Format" (see dn.form.js), as PDF. */
export async function renderDnPdf(dn, db) {
  return (await buildDnForm(dn, db)).toPdf(`DN ${dn.dnNo}`);
}

/** The same DN as an Excel file. */
export async function renderDnXlsx(dn, db) {
  return (await buildDnForm(dn, db)).toXlsx();
}
