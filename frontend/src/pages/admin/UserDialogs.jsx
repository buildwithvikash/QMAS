import { PASSWORD_RULES_TEXT, resetPasswordSchema } from '@qmas/shared';
import { Copy, KeyRound, LogOut, Mail, Monitor, Tablet } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  useEndSessionMutation, useForceLogoutUserMutation, useGetUserSessionsQuery, useLockUserMutation, useResetPasswordMutation,
  useSendResetLinkMutation, useUnlockUserMutation,
} from '../../api/adminApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextArea, TextInput } from '../../components/ui/fields.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { END_REASON, deviceOf, lockedAfterFailures, lockedByAdmin } from './userStatus.js';

function generatePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return [...bytes].map((b, i) => (i % 4 === 3 ? digits[b % digits.length] : letters[b % letters.length])).join('');
}

/**
 * Reset a password: e-mail the user a link to choose their own (preferred), or set a temporary
 * password to hand over. Either way the user is signed out everywhere.
 */
export function ResetPasswordModal({ user, onClose }) {
  const [mode, setMode] = useState(user.email ? 'link' : 'temporary');
  const form = useZodForm(resetPasswordSchema, { temporaryPassword: generatePassword() });
  const [reset, { isLoading, error }] = useResetPasswordMutation();
  const [sendLink, { isLoading: sending }] = useSendResetLinkMutation();
  const [done, setDone] = useState(null);

  const save = async () => {
    if (mode === 'link') {
      try {
        const r = await sendLink(user.id).unwrap();
        toast.success(`Reset link sent to ${r.email}; it works for ${r.minutes} minutes.`);
        onClose();
      } catch (err) {
        toast.error(apiError(err).message);
      }
      return;
    }
    const data = form.validate();
    if (!data) return;
    try {
      await reset({ id: user.id, ...data }).unwrap();
      setDone(data.temporaryPassword);
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };

  if (done) {
    return (
      <Modal title="Temporary password set" subtitle={`${user.fullName} · ${user.employeeCode}`} onClose={onClose} size="sm" footer={<div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>}>
        <p className="text-sm text-slate-600 mb-3">Give this password to {user.fullName}. It is shown only now; they must choose their own at the next sign-in.</p>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <code className="flex-1 font-mono text-lg tracking-wide text-slate-900">{done}</code>
          <button type="button" onClick={() => navigator.clipboard?.writeText(done).then(() => toast.success('Copied'))} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200 cursor-pointer" aria-label="Copy"><Copy className="w-4 h-4" /></button>
        </div>
      </Modal>
    );
  }

  const Choice = ({ value, icon: Icon, title, text, disabled }) => (
    <label className={`flex gap-3 rounded-lg border p-3 ${disabled ? 'opacity-50' : 'cursor-pointer'} ${mode === value ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
      <input type="radio" name="mode" className="mt-1 accent-blue-600" checked={mode === value} disabled={disabled} onChange={() => setMode(value)} />
      <Icon className="w-4 h-4 mt-0.5 text-blue-700 shrink-0" />
      <span><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="block text-xs text-slate-500">{text}</span></span>
    </label>
  );
  return (
    <Modal title="Reset password" subtitle={`${user.fullName} · ${user.employeeCode}`} onClose={onClose} size="sm"
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading || sending} saveLabel={mode === 'link' ? 'Send link' : 'Set temporary password'} saveVariant={mode === 'link' ? 'primary' : 'danger'} />}>
      <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />
      <div className="space-y-2 mb-4">
        <Choice value="link" icon={Mail} title="E-mail a reset link" disabled={!user.email}
          text={user.email ? `To ${user.email}. They choose their own password; the link works once, for 30 minutes.` : 'This user has no e-mail address.'} />
        <Choice value="temporary" icon={KeyRound} title="Set a temporary password" text="You hand it over; they must change it at the next sign-in. Signs them out everywhere now." />
      </div>
      {mode === 'temporary' && (
        <>
          <TextInput label="Temporary password" value={form.values.temporaryPassword} onChange={(e) => form.set('temporaryPassword', e.target.value)} error={form.error('temporaryPassword')} hint={PASSWORD_RULES_TEXT} className="font-mono" />
          <button type="button" onClick={() => form.set('temporaryPassword', generatePassword())} className="mt-2 text-xs font-semibold text-blue-600 hover:underline cursor-pointer">Generate another</button>
        </>
      )}
    </Modal>
  );
}

/** Administrator's lock, with the reason on record. */
export function LockDialog({ user, onClose }) {
  const [reason, setReason] = useState('');
  const [lock, { isLoading, error }] = useLockUserMutation();
  const save = async () => {
    try {
      await lock({ id: user.id, reason }).unwrap();
      toast.success(`${user.fullName} is locked and signed out everywhere`);
      onClose();
    } catch { /* shown below */ }
  };
  const fieldError = error && apiError(error).fieldErrors?.reason;
  return (
    <Modal title="Lock account" subtitle={`${user.fullName} · ${user.employeeCode}`} onClose={onClose} size="sm"
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Lock account" saveVariant="danger" />}>
      <FormError message={error && !fieldError ? apiError(error).message : ''} />
      <p className="text-sm text-slate-600 mb-3">Signs {user.fullName} out on every device at once. Sign-in is refused until an administrator unlocks the account. Their data and history stay.</p>
      <TextArea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} placeholder="e.g. Left the company, shared password, under review" />
    </Modal>
  );
}

export function UnlockDialog({ user, onClose }) {
  const [unlock, { isLoading }] = useUnlockUserMutation();
  const confirm = async () => {
    try {
      await unlock(user.id).unwrap();
      toast.success(`${user.fullName} can sign in again`);
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  const why = lockedByAdmin(user)
    ? `${user.fullName} was locked by ${user.lockedByName ?? 'an administrator'} on ${formatDateTime(user.lockedAt)}${user.lockedReason ? `: “${user.lockedReason}”` : ''}.`
    : lockedAfterFailures(user) ? `${user.fullName} was locked after too many failed sign-in attempts (until ${formatDateTime(user.lockedUntil)}).` : '';
  return <ConfirmDialog title="Unlock account" message={`${why} Unlock now?`} confirmLabel="Unlock" variant="primary" onConfirm={confirm} onCancel={onClose} busy={isLoading} />;
}

export function ForceLogoutDialog({ user, onClose }) {
  const [logout, { isLoading }] = useForceLogoutUserMutation();
  const confirm = async () => {
    try {
      const r = await logout(user.id).unwrap();
      toast.success(`${user.fullName} signed out of ${r.ended} session${r.ended === 1 ? '' : 's'}`);
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <ConfirmDialog title="Sign out everywhere" confirmLabel="Sign out" onConfirm={confirm} onCancel={onClose} busy={isLoading}
      message={`${user.fullName} is signed out on every device (${user.activeSessions} active session${user.activeSessions === 1 ? '' : 's'}) at their next click. Unsaved work in an open form may be lost; tablet data waiting to sync is kept. They can sign in again.`} />
  );
}

/** A user's sessions: where and when they signed in, which are open, and why others ended. */
export function SessionsModal({ user, onClose, canManage, currentSessionId }) {
  const { data: sessions = [], isLoading } = useGetUserSessionsQuery(user.id, { refetchOnMountOrArgChange: true });
  const [end, { isLoading: ending, originalArgs }] = useEndSessionMutation();
  const stop = async (s) => {
    try {
      await end(s.id).unwrap();
      toast.success('Session ended');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <Modal title="Sessions" subtitle={`${user.fullName} · ${user.employeeCode}`} onClose={onClose} size="lg">
      {isLoading ? <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div> : sessions.length === 0 ? (
        <p className="text-sm text-slate-500">No sign-ins recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 -mx-1">
          {sessions.map((s) => <SessionRow key={s.id} s={s} canEnd={canManage && s.active && s.id !== currentSessionId} ending={ending && originalArgs === s.id} onEnd={() => stop(s)} mine={s.id === currentSessionId} />)}
        </ul>
      )}
    </Modal>
  );
}

export function SessionRow({ s, canEnd, onEnd, ending, mine, showUser = false }) {
  const Icon = s.client === 'tablet' ? Tablet : Monitor;
  return (
    <li className="flex items-center gap-3 px-1 py-2.5">
      <span className={`relative w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${s.active ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
        <Icon className="w-4 h-4" />
        {s.online && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" title="Online now" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-900">
          {showUser && <span className="font-semibold">{s.fullName} <span className="font-normal text-slate-400">{s.employeeCode}</span> · </span>}
          <span className="font-mono">{s.ip ?? 'unknown IP'}</span>
          {s.hostName && <span className="text-slate-500"> · {s.hostName}</span>}
          {mine && <Badge variant="info" dot={false}>This device</Badge>}
        </p>
        <p className="text-xs text-slate-500 truncate" title={s.userAgent ?? ''}>
          {deviceOf(s.userAgent)} · signed in {formatDateTime(s.startedAt)} · {s.active ? `last seen ${formatRelative(s.lastSeenAt)}` : `${END_REASON[s.endReason] ?? 'Ended'} ${s.endedAt ? formatRelative(s.endedAt) : ''}${s.endedByName && s.endReason?.startsWith('FORCED') ? ` by ${s.endedByName}` : ''}`}
        </p>
      </div>
      {s.active ? (canEnd && (
        <Button size="sm" variant="secondary" icon={LogOut} loading={ending} onClick={onEnd}>End</Button>
      )) : <Badge variant="neutral" dot={false}>Ended</Badge>}
    </li>
  );
}
