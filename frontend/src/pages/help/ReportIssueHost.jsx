import { SUPPORT_KINDS, SUPPORT_MODULES, SUPPORT_PRIORITIES, supportTicketCreateSchema } from '@qmas/shared';
import { ImagePlus, Info, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCreateTicketMutation, useUploadTicketFileMutation } from '../../api/supportApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, Select, TextArea, TextInput } from '../../components/ui/fields.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { KIND_LOOK } from './helpLook.js';

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

// The part of QMAS the reporter was in, guessed from the page.
const MODULE_BY_PATH = [
  ['/imirs', 'Incoming inspection (IMIR)'],
  ['/tablet', 'Tablet inspection'],
  ['/deviations', 'Deviation'],
  ['/dns', 'Defect notification & CAPA'],
  ['/formats', 'Inspection formats'],
  ['/reports', 'Reports & insights'],
  ['/insights', 'Reports & insights'],
  ['/ask', 'Reports & insights'],
  ['/masters', 'Master config'],
  ['/admin/users', 'Users & roles'],
  ['/admin/roles', 'Users & roles'],
  ['/admin/sap-sync', 'SAP sync'],
  ['/change-password', 'Sign in & account'],
];
const guessModule = (path) => MODULE_BY_PATH.find(([p]) => path.startsWith(p))?.[1] ?? (path === '/' ? 'Dashboard & tasks' : null);

const clientInfo = () => ({
  browser: navigator.userAgent.slice(0, 300),
  screen: `${window.innerWidth}x${window.innerHeight}`,
  language: navigator.language,
  online: navigator.onLine,
});

/**
 * "Report a problem" dialog, mounted once in the layout. Opened with openReportIssue() from
 * anywhere; it remembers the page the user was on so the support team can find it.
 */
export default function ReportIssueHost() {
  const [open, setOpen] = useState(null); // { prefill, pageUrl }
  const location = useLocation();
  const where = useRef(location.pathname.startsWith('/help') ? null : `${location.pathname}${location.search}`);
  // The last page that is not part of Help, so "Report" from the help pages still points at it.
  useEffect(() => {
    if (!location.pathname.startsWith('/help')) where.current = `${location.pathname}${location.search}`;
  }, [location]);

  useEffect(() => {
    const onOpen = (e) => setOpen((cur) => ({ prefill: e.detail ?? {}, pageUrl: where.current, n: (cur?.n ?? 0) + 1 }));
    window.addEventListener('qmas:report-issue', onOpen);
    return () => window.removeEventListener('qmas:report-issue', onOpen);
  }, []);

  if (!open) return null;
  return <ReportIssueModal key={open.n} prefill={open.prefill} pageUrl={open.pageUrl} onClose={() => setOpen(null)} />;
}

function ReportIssueModal({ prefill, pageUrl, onClose }) {
  const navigate = useNavigate();
  const [create, { isLoading, error }] = useCreateTicketMutation();
  const [upload] = useUploadTicketFileMutation();
  const form = useZodForm(supportTicketCreateSchema, {
    kind: prefill.kind ?? 'BUG',
    module: prefill.module ?? guessModule(pageUrl ?? '') ?? null,
    priority: 'MEDIUM',
    title: prefill.title ?? '',
    description: prefill.description ?? '',
    steps: '',
    expected: '',
    reference: prefill.reference ?? '',
  });
  const [files, setFiles] = useState([]); // [{ file, url }]
  const [shareContext, setShareContext] = useState(true);
  const [busy, setBusy] = useState(false);
  const pick = useRef(null);
  const v = form.values;
  const isProblem = v.kind === 'BUG' || v.kind === 'ISSUE';

  const addFiles = useCallback((list) => {
    const incoming = [...list];
    setFiles((cur) => {
      const next = [...cur];
      for (const f of incoming) {
        if (next.length >= MAX_FILES) { toast.error(`At most ${MAX_FILES} files.`); break; }
        if (!ACCEPT.includes(f.type)) { toast.error(`${f.name || 'This file'}: attach a PNG, JPEG, WebP or PDF.`); continue; }
        if (f.size > MAX_BYTES) { toast.error(`${f.name || 'This file'} is larger than 10 MB.`); continue; }
        next.push({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
      }
      return next;
    });
  }, []);

  // Paste a screenshot straight from the clipboard (Print Screen / Win+Shift+S, then Ctrl+V).
  useEffect(() => {
    const onPaste = (e) => {
      const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!images.length) return;
      e.preventDefault();
      addFiles(images.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `screenshot-${Date.now()}-${i + 1}.png`, { type: f.type }))));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);
  // Preview URLs are freed when the dialog closes.
  const shown = useRef([]);
  useEffect(() => {
    shown.current = files;
  }, [files]);
  useEffect(() => () => shown.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []);

  const submit = async () => {
    const data = form.validate(shareContext ? { pageUrl, clientInfo: clientInfo() } : {});
    if (!data) return;
    setBusy(true);
    try {
      const t = await create(data).unwrap();
      let failed = 0;
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f.file, f.file.name);
        try { await upload({ id: t.id, formData: fd }).unwrap(); } catch { failed += 1; }
      }
      toast.success(`Ticket ${t.ticketNo} raised. The support team has been told.`);
      if (failed) toast.error(`${failed} file(s) could not be attached. Add them again on the ticket.`);
      onClose();
      navigate(`/help/tickets/${t.id}`);
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Report a problem or ask for help"
      subtitle="The QMAS support team gets your ticket at once and replies here and by mail."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Send} onClick={submit} loading={busy || isLoading}>Send ticket</Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />
        <fieldset>
          <legend className="mb-2 text-[11px] font-semibold text-slate-600">What do you need?</legend>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {SUPPORT_KINDS.map((k) => {
              const look = KIND_LOOK[k.value];
              const on = v.kind === k.value;
              return (
                <button key={k.value} type="button" onClick={() => form.set('kind', k.value)} aria-pressed={on}
                  className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all cursor-pointer ${on ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                  <span className={`grid h-8 w-8 place-items-center rounded-lg ${look.tile}`}><look.icon className="h-4 w-4" /></span>
                  <span className="text-sm font-semibold text-slate-800">{k.label}</span>
                  <span className="text-[11px] leading-snug text-slate-500">{k.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Part of QMAS" required value={v.module} onChange={(x) => form.set('module', x)} error={form.error('module')}
            options={SUPPORT_MODULES.map((m) => ({ value: m, label: m }))} placeholder="Choose…" />
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">How urgent is it?</span>
            <div role="radiogroup" className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
              {SUPPORT_PRIORITIES.map((p) => (
                <button key={p.value} type="button" role="radio" aria-checked={v.priority === p.value} title={p.hint} onClick={() => form.set('priority', p.value)}
                  className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${v.priority === p.value ? (p.value === 'CRITICAL' ? 'bg-rose-600 text-white' : p.value === 'HIGH' ? 'bg-amber-500 text-white' : 'bg-white text-blue-800 ring-1 ring-slate-200') : 'text-slate-600 hover:text-slate-900'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{SUPPORT_PRIORITIES.find((p) => p.value === v.priority)?.hint}</p>
          </div>
        </div>

        <TextInput label="Subject" required maxLength={150} placeholder={isProblem ? 'e.g. Save button on the deviation form does nothing' : 'In a few words'}
          value={v.title} onChange={(e) => form.set('title', e.target.value)} error={form.error('title')} />
        <TextArea label={isProblem ? 'What happened?' : 'Details'} required rows={4} maxLength={5000}
          placeholder={isProblem ? 'What you were doing, what you saw (copy any error message) and who else is affected.' : v.kind === 'ACCESS' ? 'Which role, plant or page you need, and why.' : 'Tell us more.'}
          value={v.description} onChange={(e) => form.set('description', e.target.value)} error={form.error('description')} />
        {isProblem && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextArea label="Steps to see it again" rows={3} maxLength={3000} placeholder={'1. Open …\n2. Click …\n3. …'}
              value={v.steps ?? ''} onChange={(e) => form.set('steps', e.target.value)} error={form.error('steps')} />
            <TextArea label="What should have happened?" rows={3} maxLength={1000}
              value={v.expected ?? ''} onChange={(e) => form.set('expected', e.target.value)} error={form.error('expected')} />
          </div>
        )}
        <TextInput label="Record number (optional)" maxLength={60} placeholder="IMIR, DN or deviation number, item code…"
          value={v.reference ?? ''} onChange={(e) => form.set('reference', e.target.value)} error={form.error('reference')} />

        <div>
          <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">Screenshots or files <span className="font-normal text-slate-400">(up to {MAX_FILES}, 10 MB each)</span></span>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 p-3"
          >
            {files.map((f, i) => (
              <div key={`${f.file.name}-${i}`} className="group relative h-20 w-28 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {f.url ? <img src={f.url} alt={f.file.name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center px-2 text-center text-[11px] text-slate-600">{f.file.name}</span>}
                <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => { if (f.url) URL.revokeObjectURL(f.url); setFiles((cur) => cur.filter((_, j) => j !== i)); }}
                  className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-0.5 text-white cursor-pointer"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {files.length < MAX_FILES && (
              <button type="button" onClick={() => pick.current?.click()} className="flex h-20 flex-1 min-w-48 items-center justify-center gap-2 rounded-lg text-sm text-slate-500 hover:text-blue-700 cursor-pointer">
                <ImagePlus className="h-5 w-5" />
                <span>Drop files, <span className="font-semibold text-blue-700">browse</span>, or paste a screenshot (Ctrl+V)</span>
              </button>
            )}
            <input ref={pick} type="file" accept={ACCEPT.join(',')} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>
        </div>

        <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={shareContext} onChange={(e) => setShareContext(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600 cursor-pointer" />
          <span>
            <span className="font-semibold text-slate-700">Include the page and browser details</span>
            <span className="block text-slate-500">Page <span className="font-mono">{pageUrl || '—'}</span>, browser, screen size and language. Helps the team see what you saw.</span>
          </span>
          <Info className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
        </label>
      </div>
    </Modal>
  );
}
