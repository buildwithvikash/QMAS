import { Fragment } from 'react';
import { Link } from 'react-router-dom';

/**
 * Small Markdown renderer for AI answers: paragraphs, **bold**, `code`, bullet and numbered lists,
 * and tables. Builds React elements (no HTML strings), so nothing in the text can inject markup.
 * IMIR, deviation and DN numbers become links to their list, searched.
 */
const DOC = /\b(IMIR\d{6,}|DEV\d{6,}|DN\d{4}[A-Z]{2}\d{4,})\b/g;
const LIST_OF = (no) => (no.startsWith('IMIR') ? '/imirs' : no.startsWith('DEV') ? '/deviations' : '/dns');

function inline(text, key = 'i') {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  let n = 0;
  const pushText = (t) => {
    let l = 0;
    let d;
    DOC.lastIndex = 0;
    while ((d = DOC.exec(t))) {
      if (d.index > l) out.push(t.slice(l, d.index));
      out.push(<Link key={`${key}-d${n++}`} to={`${LIST_OF(d[1])}?q=${encodeURIComponent(d[1])}`} className="font-mono text-blue-700 hover:underline">{d[1]}</Link>);
      l = d.index + d[1].length;
    }
    if (l < t.length) out.push(t.slice(l));
  };
  while ((m = re.exec(text))) {
    if (m.index > last) pushText(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${key}-b${n++}`} className="font-semibold text-slate-900">{tok.slice(2, -2)}</strong>);
    else out.push(<code key={`${key}-c${n++}`} className="rounded bg-slate-100 px-1 text-[0.9em]">{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) pushText(text.slice(last));
  return out;
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export default function Markdown({ text }) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (line.trim().startsWith('|') && lines[i + 1]?.match(/^\s*\|?\s*:?-{2,}/)) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={`t${i}`} className="overflow-x-auto my-2">
          <table className="text-xs border border-slate-200 rounded">
            <thead className="bg-slate-50"><tr>{head.map((h, j) => <th key={j} className="px-2 py-1 text-left font-semibold text-slate-600 border-b border-slate-200">{inline(h, `h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="px-2 py-1 text-slate-800 tabular">{inline(c, `c${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*[-*]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={`l${i}`} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-1.5 space-y-0.5`}>{items.map((it, j) => <li key={j}>{inline(it, `li${i}-${j}`)}</li>)}</Tag>);
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)/);
    if (heading) {
      blocks.push(<p key={`h${i}`} className="font-semibold text-slate-900 mt-2">{inline(heading[1], `hd${i}`)}</p>);
      i += 1;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('|') && !bullet.test(lines[i]) && !numbered.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={`p${i}`} className="my-1.5">{para.map((p, j) => <Fragment key={j}>{j ? <br /> : null}{inline(p, `p${i}-${j}`)}</Fragment>)}</p>);
  }
  return <div className="text-sm text-slate-800 leading-relaxed">{blocks}</div>;
}
