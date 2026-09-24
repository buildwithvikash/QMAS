import { SECTION_LABELS, SECTIONS } from '@qmas/shared';
import Badge from '../../components/ui/Badge.jsx';
import { fieldLabel, fmtNum, fmtValue, sectionColumns, STATUS } from './formatHelpers.js';

export const StatusBadge = ({ status }) => <Badge variant={STATUS[status]?.[1] ?? 'neutral'}>{STATUS[status]?.[0] ?? status}</Badge>;
export const VersionTag = ({ no }) => (no ? <span className="font-mono text-xs font-semibold text-slate-700">v{no}</span> : <span className="text-xs text-slate-400">—</span>);

const NUMERIC = new Set(['nominal', 'lsl', 'usl', 'frequencyMonths']);

/**
 * Read-only format content: one table per section, like the JIR sheet.
 * With `diff` (from diffVersions), added rows are green, changed cells show old → new, and removed
 * rows are listed struck through.
 */
export function FormatContent({ checkpoints, diff }) {
  const added = new Set(diff?.added.map((c) => c.uid));
  const changed = new Map(diff?.changed.map((c) => [c.uid, new Map(c.fields.map((f) => [f.field, f.from]))]));
  const removed = diff?.removed ?? [];

  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => {
        const rows = checkpoints.filter((c) => c.section === section);
        const gone = removed.filter((c) => c.section === section);
        if (!rows.length && !gone.length) return null;
        const cols = sectionColumns(section);
        return (
          <section key={section} className="card overflow-hidden">
            <h3 className="px-4 py-2.5 text-sm font-bold text-slate-700 bg-slate-50 border-b border-slate-200">
              {SECTION_LABELS[section]} test <span className="font-normal text-slate-400">· {rows.length}</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] font-medium text-slate-500">
                    <th className="px-3 py-2 text-left w-10">#</th>
                    {cols.map((c) => <th key={c} className={`px-3 py-2 ${NUMERIC.has(c) ? 'text-right' : 'text-left'}`}>{fieldLabel(c)}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((c) => {
                    const ch = changed.get(c.uid);
                    return (
                      <tr key={c.uid} className={added.has(c.uid) ? 'bg-emerald-50/70' : ch ? 'bg-amber-50/50' : ''}>
                        <td className="px-3 py-2 text-slate-400 tabular">{c.seq}{added.has(c.uid) && <span className="ml-1 text-[10px] font-bold text-emerald-600">NEW</span>}</td>
                        {cols.map((f) => (
                          <td key={f} className={`px-3 py-2 ${NUMERIC.has(f) ? 'text-right tabular whitespace-nowrap' : ''}`}>
                            {ch?.has(f) && <span className="block text-xs text-rose-500 line-through">{fmtValue(f, ch.get(f))}</span>}
                            <span className={ch?.has(f) ? 'font-semibold text-amber-800' : ''}>{f === 'frequencyMonths' ? (c[f] ? fmtValue(f, c[f]) : 'every lot') : NUMERIC.has(f) ? fmtNum(c[f]) : (c[f] ?? '')}</span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {gone.map((c) => (
                    <tr key={c.uid} className="bg-rose-50/60 text-rose-600 line-through">
                      <td className="px-3 py-2 text-xs no-underline">removed</td>
                      {cols.map((f) => <td key={f} className={`px-3 py-2 ${NUMERIC.has(f) ? 'text-right' : ''}`}>{NUMERIC.has(f) ? fmtNum(c[f]) : (c[f] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {!checkpoints.length && !removed.length && <p className="text-sm text-slate-400">No checkpoints yet.</p>}
    </div>
  );
}

export function DiffSummary({ diff }) {
  if (!diff) return null;
  const parts = [
    diff.added.length && `${diff.added.length} added`,
    diff.changed.length && `${diff.changed.length} changed`,
    diff.removed.length && `${diff.removed.length} removed`,
    diff.header.length && `${diff.header.length} header field${diff.header.length > 1 ? 's' : ''} changed`,
  ].filter(Boolean);
  return <span>{parts.length ? parts.join(' · ') : 'No content changes'}</span>;
}
