/**
 * QMAS mail layout, in the app's theme (refrigerant blue, WRL green strip, frost canvas).
 * Built from tables with inline styles so it renders the same in Outlook, Gmail and phones.
 * Everything passed in is escaped here; callers hand over plain text.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nl2br = (s) => esc(s).replace(/\r?\n/g, '<br>');

const C = {
  canvas: '#f2f5f9', card: '#ffffff', line: '#e2e8f0', ink: '#0f172a', text: '#334155', muted: '#64748b', faint: '#94a3b8',
  blue: '#0067b8', blueDark: '#0b3a64', blueSoft: '#e8f4fd', wrl: '#3f8f3a',
};
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Tone of the message: the pill, the accent bar and the "what to do" box. */
export const TONES = {
  action: { label: 'Action needed', fg: '#005396', bg: '#e8f4fd', bar: '#0067b8' },
  escalation: { label: 'Escalated', fg: '#9a3412', bg: '#fff1e6', bar: '#ea580c' },
  sendback: { label: 'Sent back', fg: '#92400e', bg: '#fef3c7', bar: '#d97706' },
  good: { label: 'Closed', fg: '#166534', bg: '#dcfce7', bar: '#16a34a' },
  bad: { label: 'Rejected', fg: '#9f1239', bg: '#ffe4e6', bar: '#e11d48' },
  reminder: { label: 'Reminder', fg: '#92400e', bg: '#fef3c7', bar: '#d97706' },
  info: { label: 'For your information', fg: '#334155', bg: '#f1f5f9', bar: '#64748b' },
};

// Colour of a status word in the recent-activity table.
const STATUS_FG = { good: '#15803d', bad: '#be123c', warn: '#b45309', esc: '#c2410c', info: '#0067b8' };

function factsTable(facts) {
  const rows = facts.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0 0;border:1px solid ${C.line};border-radius:8px">
${rows.map(([k, v, strong], i) => `<tr><td style="padding:6px 10px;font-size:12px;color:${C.muted};width:36%;vertical-align:top;${i ? `border-top:1px solid ${C.line};` : ''}background:#f8fafc">${esc(k)}</td><td style="padding:6px 10px;font-size:13px;color:${strong ? C.ink : C.text};${strong ? 'font-weight:600;' : ''}vertical-align:top;${i ? `border-top:1px solid ${C.line};` : ''}">${nl2br(v)}</td></tr>`).join('\n')}
</table>`;
}

function stepsTable(steps) {
  if (!steps?.length) return '';
  const th = (t) => `<th align="left" style="padding:5px 8px;font-size:11px;font-weight:600;color:${C.muted};background:#f8fafc;border-bottom:1px solid ${C.line}">${t}</th>`;
  return `<div style="margin:16px 0 4px;font-size:12px;font-weight:700;color:${C.ink}">Recent activity</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${C.line}">
<tr>${th('Step')}${th('By')}${th('When')}</tr>
${steps.map((s) => `<tr><td style="padding:5px 8px;font-size:12px;border-top:1px solid ${C.line};color:${STATUS_FG[s.tone] ?? C.text};font-weight:600">${esc(s.label)}</td><td style="padding:5px 8px;font-size:12px;border-top:1px solid ${C.line};color:${C.text}">${esc(s.by)}${s.role ? `<br><span style="color:${C.faint};font-size:11px">${esc(s.role)}</span>` : ''}</td><td style="padding:5px 8px;font-size:12px;border-top:1px solid ${C.line};color:${C.muted};white-space:nowrap">${esc(s.at)}</td></tr>`).join('\n')}
</table>`;
}

/**
 * One mail. m = { tone, pill, greeting, title, record (e.g. "IMIR1115260925001"), todo, due, remark: { text, by },
 * facts: [[label, value, strong?]], steps: [{ label, by, role, at, tone }], url, button, reason, plant }
 * Returns { html, text }.
 */
export function renderMail(m) {
  const t = TONES[m.tone] ?? TONES.info;
  const pill = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${t.bg};color:${t.fg};font-size:11px;font-weight:700;letter-spacing:.02em">${esc(m.pill ?? t.label)}</span>`;
  const todo = m.todo
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr><td style="background:${t.bg};border-left:4px solid ${t.bar};padding:9px 12px;font-size:13px;color:${C.ink}">
<strong style="color:${t.fg}">${m.tone === 'good' || m.tone === 'bad' || m.tone === 'info' ? 'Outcome' : 'What to do'}:</strong> ${esc(m.todo)}${m.due ? `<br><span style="font-size:12px;color:${C.text}">Due by <strong>${esc(m.due)}</strong></span>` : ''}
</td></tr></table>` : '';
  const remark = m.remark?.text
    ? `<div style="margin:14px 0 0;font-size:11px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:.06em">Remark${m.remark.by ? ` from ${esc(m.remark.by)}` : ''}</div>
<div style="margin-top:4px;border-left:3px solid ${C.blue};background:${C.blueSoft};padding:8px 12px;font-size:13px;color:${C.ink};line-height:1.45">${nl2br(m.remark.text)}</div>` : '';
  const button = m.url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr><td style="background:${C.blue};border-radius:6px">
<a href="${esc(m.url)}" style="display:inline-block;padding:9px 18px;font-family:${FONT};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none">${esc(m.button ?? 'Open in QMAS')} &rarr;</a></td></tr></table>
<div style="font-size:11px;color:${C.faint};word-break:break-all">Or paste this link: <a href="${esc(m.url)}" style="color:${C.blue}">${esc(m.url)}</a></div>` : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.title)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas};font-family:${FONT};color:${C.text}">
<div style="display:none;max-height:0;overflow:hidden">${esc(m.todo ?? m.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas}"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:8px;overflow:hidden">
<tr><td style="height:4px;background:${C.wrl};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="background:${C.blueDark};padding:10px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:14px;font-weight:700;color:#ffffff;letter-spacing:.02em">QMAS <span style="font-weight:400;color:#cce7fb">· Incoming Inspection</span></td>
<td align="right" style="font-size:11px;color:#cce7fb">${esc(m.plant ?? '')}</td>
</tr></table></td></tr>
<tr><td style="padding:16px 18px 18px;border-top:3px solid ${t.bar}">
${pill}${m.record ? `<span style="margin-left:8px;font-size:12px;font-family:Consolas,Menlo,monospace;color:${C.muted}">${esc(m.record)}</span>` : ''}
${m.greeting ? `<div style="margin-top:10px;font-size:13px;color:${C.text}">Hello ${esc(m.greeting)},</div>` : ''}
<h1 style="margin:6px 0 0;font-size:17px;line-height:1.3;color:${C.ink}">${esc(m.title)}</h1>
${todo}${remark}${factsTable(m.facts ?? [])}${stepsTable(m.steps)}${button}
</td></tr>
<tr><td style="padding:10px 18px;background:#f8fafc;border-top:1px solid ${C.line};font-size:11px;color:${C.faint};line-height:1.5">
${m.reason ? `${esc(m.reason)}<br>` : ''}Automatic message from QMAS, Western Refrigeration. Please do not reply to this mail.
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `${m.pill ?? t.label}${m.record ? ` · ${m.record}` : ''}`,
    m.title,
    m.todo ? `\n${m.tone === 'good' || m.tone === 'bad' || m.tone === 'info' ? 'Outcome' : 'What to do'}: ${m.todo}${m.due ? `\nDue by ${m.due}` : ''}` : '',
    m.remark?.text ? `\nRemark${m.remark.by ? ` from ${m.remark.by}` : ''}:\n${m.remark.text}` : '',
    (m.facts ?? []).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ', ')}`).join('\n'),
    m.steps?.length ? `Recent activity:\n${m.steps.map((s) => `- ${s.label}, ${s.by}${s.role ? ` (${s.role})` : ''}, ${s.at}`).join('\n')}` : '',
    m.url ? `\nOpen in QMAS: ${m.url}` : '',
    '\n--\nAutomatic message from QMAS. Please do not reply.',
  ].filter(Boolean).join('\n');
  return { html, text };
}
