import { SUPPORT_PRIORITIES, SUPPORT_STATUSES } from '@qmas/shared';
import {
  ArrowLeft, CheckCircle2, CircleDot, FileText, Flag, Globe, ImagePlus, LifeBuoy, Lock, MessageSquare, Monitor, Paperclip, RotateCcw, Send, UserCheck, XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import {
  ticketFileUrl, useCommentTicketMutation, useGetSupportTeamQuery, useGetTicketQuery, useUpdateTicketMutation, useUploadTicketFileMutation,
} from '../../api/supportApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Loader from '../../components/ui/Loader.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime, formatRelative, initials } from '../../utils/format.js';
import { KIND_LOOK, PRIORITY_VARIANT, STATUS_VARIANT, kindOf, priorityOf, statusOf } from './helpLook.js';

const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** One ticket: the problem, the conversation with the support team, and its status. */
export default function TicketPage() {
  const { id } = useParams();
  const { user } = useAccess();
  const { data: t, isLoading, error } = useGetTicketQuery(id);
  const [update, { isLoading: saving }] = useUpdateTicketMutation();
  const [confirm, setConfirm] = useState(null); // { status, title, message, label, variant }

  if (isLoading) return <Loader />;
  if (error || !t) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-slate-600">{apiError(error).message || 'Ticket not found.'}</p>
        <Link to="/help/tickets" className="text-sm font-semibold text-blue-700 hover:underline">Back to my tickets</Link>
      </div>
    );
  }
  const can = (a) => t.allowedActions.includes(a);
  const look = KIND_LOOK[t.kind];
  const change = async (patch, done) => {
    try {
      await update({ id, ...patch }).unwrap();
      toast.success(done);
      setConfirm(null);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader icon={LifeBuoy} title={t.title} subtitle={`${t.ticketNo} · ${kindOf(t.kind).label} · ${t.module}`}>
        {can('confirm') && <Button size="sm" icon={CheckCircle2} onClick={() => change({ status: 'CLOSED' }, 'Thanks! The ticket is closed.')}>It works now, close</Button>}
        {can('reopen') && <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setConfirm({ status: 'OPEN', title: 'Reopen this ticket?', message: 'The support team is told the problem is not solved. Add a reply below to say what still happens.', label: 'Reopen', variant: 'primary' })}>Still a problem</Button>}
        {can('withdraw') && <Button size="sm" variant="ghost" icon={XCircle} onClick={() => setConfirm({ status: 'CLOSED', title: 'Withdraw this ticket?', message: 'Use this when the problem went away or you raised it by mistake. The ticket is closed.', label: 'Withdraw', variant: 'danger' })}>Withdraw</Button>}
      </PageHeader>

      <div className="p-5">
        <Link to="/help/tickets" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-700"><ArrowLeft className="h-3.5 w-3.5" />Back to tickets</Link>
        {t.status === 'WAITING' && t.reportedBy === user?.id && (
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <MessageSquare className="h-4 w-4 shrink-0" />The support team is waiting for your answer. Reply below and the ticket goes back to them.
          </p>
        )}
        {t.status === 'RESOLVED' && t.reportedBy === user?.id && (
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0" />The support team marked this resolved. Check it, then close the ticket, or tell them it is still a problem.
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-5 min-w-0">
            <section className="card p-5">
              <div className="flex items-start gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${look.tile}`}><look.icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[t.status]}>{statusOf(t.status).label}</Badge>
                    <Badge variant={PRIORITY_VARIANT[t.priority]} dot>{priorityOf(t.priority).label}</Badge>
                    {t.reference && <Badge variant="neutral">Ref. {t.reference}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Raised by <span className="font-medium text-slate-700">{t.reportedByName}</span> · {formatDateTime(t.createdAt)}</p>
                </div>
              </div>
              <Block title="What happened">{t.description}</Block>
              {t.steps && <Block title="Steps to see it again">{t.steps}</Block>}
              {t.expected && <Block title="What should have happened">{t.expected}</Block>}
              <Files ticket={t} canAttach={can('attach')} />
            </section>

            <Conversation ticket={t} />
            {can('comment') ? <Reply ticket={t} internalAllowed={can('internal')} /> : (
              <p className="card p-4 text-center text-sm text-slate-500">This ticket is closed. If the problem is back, raise a new ticket.</p>
            )}
          </div>

          <aside className="space-y-4">
            <Details ticket={t} canManage={can('status')} saving={saving} onChange={change} />
            <section className="card p-4 text-sm">
              <h2 className="mb-3 font-semibold text-slate-800">Where it happened</h2>
              <dl className="space-y-2.5">
                <Row icon={Globe} label="Page">{t.pageUrl ? <Link to={t.pageUrl} className="font-mono text-xs text-blue-700 hover:underline break-all">{t.pageUrl}</Link> : '—'}</Row>
                <Row icon={Monitor} label="Screen">{t.clientInfo?.screen ?? '—'}{t.clientInfo?.language ? ` · ${t.clientInfo.language}` : ''}{t.clientInfo?.online === false ? ' · offline' : ''}</Row>
                <Row icon={FileText} label="Browser"><span className="text-xs text-slate-500 break-all">{t.clientInfo?.browser ?? '—'}</span></Row>
              </dl>
            </section>
          </aside>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          variant={confirm.variant}
          busy={saving}
          onCancel={() => setConfirm(null)}
          onConfirm={() => change({ status: confirm.status }, confirm.status === 'OPEN' ? 'Ticket reopened.' : 'Ticket withdrawn.')}
        />
      )}
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div className="mt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{children}</p>
    </div>
  );
}

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <dt className="text-[11px] text-slate-400">{label}</dt>
        <dd className="text-slate-700">{children}</dd>
      </div>
    </div>
  );
}

function Files({ ticket, canAttach }) {
  const [upload, { isLoading }] = useUploadTicketFileMutation();
  const pick = useRef(null);
  const send = async (file) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    try {
      await upload({ id: ticket.id, formData: fd }).unwrap();
      toast.success('File attached.');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  if (!ticket.attachments.length && !canAttach) return null;
  return (
    <div className="mt-5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Paperclip className="h-3.5 w-3.5" />Screenshots & files</h3>
      <div className="mt-2 flex flex-wrap gap-3">
        {ticket.attachments.map((f) => {
          const url = ticketFileUrl(ticket.id, f.id);
          return (
            <a key={f.id} href={url} target="_blank" rel="noreferrer" title={`${f.fileName} · ${sizeText(f.sizeBytes)} · ${f.uploadedByName ?? ''}`}
              className="group block w-36 overflow-hidden rounded-lg border border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm">
              {f.mimeType.startsWith('image/') ? <img src={url} alt={f.fileName} loading="lazy" className="h-24 w-full object-cover" /> : <span className="grid h-24 place-items-center bg-slate-50"><FileText className="h-8 w-8 text-slate-400" /></span>}
              <span className="block truncate px-2 py-1.5 text-[11px] text-slate-600">{f.fileName}</span>
            </a>
          );
        })}
        {canAttach && ticket.attachments.length < 5 && (
          <button type="button" disabled={isLoading} onClick={() => pick.current?.click()}
            className="flex h-[7.4rem] w-36 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-200 text-xs text-slate-500 hover:border-blue-300 hover:text-blue-700 cursor-pointer disabled:opacity-50">
            <ImagePlus className="h-5 w-5" />{isLoading ? 'Uploading…' : 'Add a file'}
          </button>
        )}
        <input ref={pick} type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { if (e.target.files[0]) send(e.target.files[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}

// In the history, name the waiting state the same way for everyone.
const stateName = (v) => (v === 'WAITING' ? 'Waiting for reporter' : statusOf(v).label);
const EVENT_TEXT = {
  CREATED: () => 'raised the ticket',
  STATUS: (e) => `changed the status${e.fromValue ? ` from ${stateName(e.fromValue)}` : ''} to ${stateName(e.toValue)}`,
  PRIORITY: (e) => `changed the priority from ${priorityOf(e.fromValue).label} to ${priorityOf(e.toValue).label}`,
  ASSIGNED: (e) => (e.toValue ? `assigned the ticket to ${e.toValue}` : 'removed the assignee'),
  FILE: (e) => `attached ${e.body}`,
};
const EVENT_ICON = { CREATED: CircleDot, STATUS: CheckCircle2, PRIORITY: Flag, ASSIGNED: UserCheck, FILE: Paperclip };

function Conversation({ ticket }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-800"><MessageSquare className="h-4 w-4 text-slate-400" />Conversation & history</h2>
      <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-4 before:top-2 before:w-px before:bg-slate-200">
        {ticket.events.map((e) => {
          if (e.kind === 'COMMENT') {
            const team = !e.byReporter;
            return (
              <li key={e.id} className="relative flex gap-3">
                <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white ${team ? 'bg-blue-700' : 'bg-slate-500'}`}>{initials(e.actorName)}</span>
                <div className={`min-w-0 flex-1 rounded-xl border px-4 py-3 ${e.internal ? 'border-amber-200 bg-amber-50' : team ? 'border-blue-100 bg-blue-50/50' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-800">{e.actorName}</span>
                    {team && <Badge variant="info">Support</Badge>}
                    {e.internal && <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><Lock className="h-3 w-3" />Internal note</span>}
                    <span className="ml-auto text-slate-400" title={formatDateTime(e.at)}>{formatRelative(e.at)}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{e.body}</p>
                </div>
              </li>
            );
          }
          const Icon = EVENT_ICON[e.kind] ?? CircleDot;
          return (
            <li key={e.id} className="relative flex items-start gap-3 pl-1">
              <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white ring-1 ring-slate-200"><Icon className="h-3.5 w-3.5 text-slate-500" /></span>
              <div className="min-w-0 pt-0.5 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{e.actorName ?? 'QMAS'}</span> {EVENT_TEXT[e.kind]?.(e) ?? e.kind}
                <span className="text-slate-400"> · {formatDateTime(e.at)}</span>
                {e.body && e.kind === 'STATUS' && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{e.body}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Reply({ ticket, internalAllowed }) {
  const [comment, { isLoading }] = useCommentTicketMutation();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const send = async () => {
    if (!body.trim()) return;
    try {
      await comment({ id: ticket.id, body, internal }).unwrap();
      setBody('');
      toast.success(internal ? 'Note added.' : 'Reply sent.');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <section className={`card p-4 ${internal ? 'ring-2 ring-amber-300' : ''}`}>
      <label htmlFor="ticket-reply" className="text-sm font-semibold text-slate-800">{internal ? 'Internal note (support team only)' : 'Reply'}</label>
      <textarea id="ticket-reply" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
        placeholder={internal ? 'Notes for the team; the reporter does not see this.' : 'Write your message…'}
        className={`mt-2 w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-4 ${internal ? 'border-amber-300 bg-amber-50/40 focus:ring-amber-500/10' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500/10'}`} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {internalAllowed && (
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-4 w-4 accent-amber-500 cursor-pointer" />Internal note
          </label>
        )}
        <span className="text-[11px] text-slate-400">Ctrl+Enter to send</span>
        <Button className="ml-auto" size="sm" icon={Send} loading={isLoading} disabled={!body.trim()} onClick={send}>{internal ? 'Add note' : 'Send reply'}</Button>
      </div>
    </section>
  );
}

function Details({ ticket, canManage, saving, onChange }) {
  const { user } = useAccess();
  const { data: team = [] } = useGetSupportTeamQuery(undefined, { skip: !canManage });
  const field = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 cursor-pointer disabled:opacity-60';
  return (
    <section className="card p-4 text-sm">
      <h2 className="mb-3 font-semibold text-slate-800">Details</h2>
      <dl className="space-y-3">
        <div>
          <dt className="mb-1 text-[11px] text-slate-400">Status</dt>
          <dd>
            {canManage ? (
              <select aria-label="Status" disabled={saving} value={ticket.status} className={field}
                onChange={(e) => onChange({ status: e.target.value }, `Status: ${statusOf(e.target.value).label}`)}>
                {SUPPORT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.value === 'WAITING' ? 'Waiting for reporter' : s.label}</option>)}
              </select>
            ) : <Badge variant={STATUS_VARIANT[ticket.status]}>{statusOf(ticket.status).label}</Badge>}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-[11px] text-slate-400">Priority</dt>
          <dd>
            {canManage ? (
              <select aria-label="Priority" disabled={saving} value={ticket.priority} className={field}
                onChange={(e) => onChange({ priority: e.target.value }, `Priority: ${priorityOf(e.target.value).label}`)}>
                {SUPPORT_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            ) : <Badge variant={PRIORITY_VARIANT[ticket.priority]} dot>{priorityOf(ticket.priority).label}</Badge>}
          </dd>
        </div>
        <div>
          <dt className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
            Assigned to
            {canManage && ticket.assignedTo !== user?.id && (
              <button type="button" disabled={saving} onClick={() => onChange({ assignedTo: user.id }, 'Assigned to you.')} className="font-semibold text-blue-700 hover:underline cursor-pointer">Assign to me</button>
            )}
          </dt>
          <dd>
            {canManage ? (
              <select aria-label="Assigned to" disabled={saving} value={ticket.assignedTo ?? ''} className={field}
                onChange={(e) => onChange({ assignedTo: e.target.value || null }, e.target.value ? 'Ticket assigned.' : 'Assignee removed.')}>
                <option value="">Not assigned</option>
                {team.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.employeeCode})</option>)}
              </select>
            ) : <span className="text-slate-700">{ticket.assignedToName ?? 'The support team will pick it up'}</span>}
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
          <div><dt className="text-[11px] text-slate-400">Reported by</dt><dd className="text-slate-700">{ticket.reportedByName}<span className="block text-xs text-slate-400">{ticket.reportedByCode}</span></dd></div>
          <div><dt className="text-[11px] text-slate-400">Raised</dt><dd className="text-slate-700">{formatDateTime(ticket.createdAt)}</dd></div>
          <div><dt className="text-[11px] text-slate-400">Last update</dt><dd className="text-slate-700">{formatRelative(ticket.updatedAt)}</dd></div>
          <div><dt className="text-[11px] text-slate-400">{ticket.closedAt ? 'Closed' : 'Resolved'}</dt><dd className="text-slate-700">{ticket.closedAt || ticket.resolvedAt ? formatDateTime(ticket.closedAt ?? ticket.resolvedAt) : '—'}</dd></div>
        </div>
      </dl>
    </section>
  );
}
