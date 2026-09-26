import { FileSpreadsheet, Printer } from 'lucide-react';

const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50';

/**
 * The record's official form (the review-workbook layout): PDF to view or print, Excel to download.
 * `href` is the API path of the record, e.g. /api/v1/dns/<id>.
 */
export default function ExportLinks({ href }) {
  return (
    <span className="inline-flex gap-1.5">
      <a href={`${href}/pdf`} target="_blank" rel="noreferrer" className={btn} title="Open the printable PDF"><Printer className="w-4 h-4" />PDF</a>
      <a href={`${href}/xlsx`} download className={btn} title="Download in the Excel format"><FileSpreadsheet className="w-4 h-4 text-emerald-700" />Excel</a>
    </span>
  );
}
