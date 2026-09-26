import { PERMISSIONS } from '@qmas/shared';
import {
  Activity, ChevronDown, History, KeyRound, Lock, LockOpen, LogOut, MonitorSmartphone, Pencil, Power, Search, UserCheck, UserPlus, Users, UserX, X,
} from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  useEndAllSessionsMutation, useEndSessionMutation, useGetActiveSessionsQuery, useGetAuthEventsQuery, useGetUserQuery, useGetUserSessionsQuery,
  useGetUserSummaryQuery, useGetUsersQuery, useUpdateUserMutation,
} from '../../api/adminApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable, { Pagination } from '../../components/ui/DataTable.jsx';
import { Select } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal, { ConfirmDialog } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useListParams } from '../../hooks/useListParams.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { ForceLogoutDialog, LockDialog, ResetPasswordModal, SessionRow, SessionsModal, UnlockDialog } from './UserDialogs.jsx';
import UserFormModal from './UserFormModal.jsx';
import { EVENTS, FAIL_REASON, isLocked, lockedAfterFailures, lockedByAdmin } from './userStatus.js';

/**
 * User Management: every account with its role, account state, presence, last sign-in and the IP
 * addresses and computer names it is signed in from; active sessions; and the activity log.
 * Administrators edit, deactivate, lock, sign out and reset passwords from each row.
 */
export default function UsersPage() {
  const { user: me, can } = useAccess();
  const canManage = can(PERMISSIONS.USERS_MANAGE);
  const canAudit = can(PERMISSIONS.AUDIT_VIEW);
  const [tab, setTab] = useState('users');
  const list = useListParams({ sort: 'fullName', storageKey: 'users' });
  const poll = { pollingInterval: 30_000, refetchOnFocus: true };
  const { data, isFetching, error } = useGetUsersQuery(list.params, poll);
  const { data: summary } = useGetUserSummaryQuery(undefined, poll);
  const { data: lookups } = useGetLookupsQuery();
  const [modal, setModal] = useState(null); // { type, user }
  const [logUser, setLogUser] = useState(''); // activity log of one user
  const [openRow, setOpenRow] = useState(null); // user whose sessions are expanded
  const close = () => setModal(null);
  const act = (type, u) => (type === 'log' ? (setLogUser(u.id), setTab('log')) : setModal({ type, user: u }));

  // Opened from Roles & Permissions ("n users"): show that role's users. The role filter is not
  // carried over to a later plain visit, so the page does not stay stuck on one role.
  const roleFromLink = new URLSearchParams(window.location.search).get('roleCode');
  useEffect(() => {
    list.setFilter('roleCode', roleFromLink ?? undefined);
  }, [roleFromLink]); // eslint-disable-line react-hooks/exhaustive-deps
  const narrowed = !!(list.search || list.filters.roleCode || list.filters.plantId || list.filters.status);
  const clearAll = () => {
    list.clearFilters();
    if (roleFromLink) window.history.replaceState(null, '', window.location.pathname);
  };

  const status = list.filters.status ?? '';
  const chips = [
    ['', 'All', summary?.total],
    ['online', 'Online', summary?.online],
    ['multiple', 'Multiple logins', summary?.multiple],
    ['locked', 'Locked', summary?.locked],
    ['mustChange', 'Temp password', summary?.mustChange],
    ['inactive', 'Deactivated', summary?.inactive],
  ];
  const roleOptions = (lookups?.roles ?? []).map((r) => ({ value: r.code, label: r.name }));
  const plantOptions = (lookups?.plants ?? []).map((p) => ({ value: String(p.id), label: `${p.name} (${p.sapCode})` }));
  const th = 'px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap';

  return (
    <div>
      <PageHeader icon={Users} title="User Management" subtitle="Accounts and roles, who is signed in and from where, sign-outs, locks and password resets" />

      <div className="p-4 sm:p-5">
        <section className="card overflow-hidden">
          <div role="tablist" className="flex gap-1 px-3 border-b border-slate-200 overflow-x-auto no-scrollbar">
            {[
              ['users', 'Users', Users, summary?.total],
              ['sessions', 'Active Sessions', MonitorSmartphone, summary?.sessions],
              ...(canAudit ? [['log', 'Activity Log', History, null]] : []),
            ].map(([k, l, Icon, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-3 -mb-px border-b-2 text-sm cursor-pointer ${tab === k ? 'border-blue-600 text-blue-800 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
                <Icon className="w-4 h-4" />{l}
                {n != null && <span className={`rounded-full px-1.5 text-[11px] tabular ${tab === k ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'}`}>{n}</span>}
              </button>
            ))}
            {canManage && tab === 'sessions' && (
              <button type="button" onClick={() => setModal({ type: 'endAll' })} className="ml-auto my-2 inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer">
                <Power className="w-4 h-4" />Sign out everyone
              </button>
            )}
          </div>

          {tab === 'users' && (
            <>
              <div className="flex flex-wrap items-center gap-2 px-3 py-3 border-b border-slate-100">
                <label className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder="Search name, ID, role, IP, host…" aria-label="Search users"
                    className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white" />
                </label>
                {chips.map(([v, l, n]) => (
                  <button key={l} type="button" onClick={() => (v === '' ? clearAll() : list.setFilter('status', v))} aria-pressed={v === '' ? !narrowed : status === v}
                    className={`h-8 px-3 rounded-full text-xs font-semibold cursor-pointer transition-colors ${(v === '' ? !narrowed : status === v) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {l} <span className={`tabular ${(v === '' ? !narrowed : status === v) ? 'text-blue-100' : 'text-slate-400'}`}>{n ?? ''}</span>
                  </button>
                ))}
                <Select className="w-44" aria-label="Role" placeholder="Any role" value={list.filters.roleCode ?? ''} onChange={(v) => list.setFilter('roleCode', v)} options={roleOptions} />
                <Select className="w-44" aria-label="Plant" placeholder="Any plant" value={list.filters.plantId ?? ''} onChange={(v) => list.setFilter('plantId', v)} options={plantOptions} />
                {narrowed && (
                  <button type="button" onClick={clearAll} className="h-8 px-2.5 inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer">
                    <X className="w-3.5 h-3.5" />Clear filters
                  </button>
                )}
                {canManage && <Button size="sm" icon={UserPlus} className="ml-auto" onClick={() => setModal({ type: 'create' })}>Add user</Button>}
              </div>

              {error && <p className="px-4 py-6 text-sm text-rose-700">{apiError(error).message}</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/80">
                    <tr>
                      {['User', 'Role', 'Account', 'Presence', 'Last login', 'IP address', 'Host name', 'Sessions', 'Actions'].map((h) => <th key={h} className={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isFetching && !data && [1, 2, 3, 4, 5].map((i) => <tr key={i}><td colSpan={9} className="px-3 py-3"><div className="skeleton h-8" /></td></tr>)}
                    {data?.rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">No users match these filters.</td></tr>}
                    {data?.rows.map((u) => (
                      <Fragment key={u.id}>
                        <UserRow u={u} isMe={u.id === me.id} canManage={canManage} canAudit={canAudit} open={openRow === u.id}
                          onToggle={() => setOpenRow(openRow === u.id ? null : u.id)} onAct={(type) => act(type, u)} />
                        {openRow === u.id && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={9} className="px-6 py-2"><UserSessionsInline user={u} canManage={canManage} currentSessionId={me.sessionId} /></td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-3 pb-3"><Pagination meta={data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} /></div>
            </>
          )}
          {tab === 'sessions' && <SessionsTab canManage={canManage} currentSessionId={me.sessionId} />}
          {tab === 'log' && canAudit && <ActivityLog userId={logUser} users={data?.rows ?? []} onUser={setLogUser} />}
        </section>
      </div>

      {modal?.type === 'create' && <UserFormModal lookups={lookups} onClose={close} />}
      {modal?.type === 'edit' && <EditUser id={modal.user.id} lookups={lookups} onClose={close} />}
      {modal?.type === 'reset' && <ResetPasswordModal user={modal.user} onClose={close} />}
      {modal?.type === 'lock' && <LockDialog user={modal.user} onClose={close} />}
      {modal?.type === 'unlock' && <UnlockDialog user={modal.user} onClose={close} />}
      {modal?.type === 'logout' && <ForceLogoutDialog user={modal.user} onClose={close} />}
      {modal?.type === 'active' && <ActiveDialog user={modal.user} onClose={close} />}
      {modal?.type === 'sessions' && <SessionsModal user={modal.user} onClose={close} canManage={canManage} currentSessionId={me.sessionId} />}
      {modal?.type === 'endAll' && <EndAllDialog onClose={close} />}
    </div>
  );
}

const Stack = ({ items, mono }) => (items.length ? (
  <div className={`space-y-0.5 text-xs text-slate-700 ${mono ? 'font-mono' : ''}`}>{items.map((x) => <div key={x}>{x}</div>)}</div>
) : <span className="text-xs text-slate-300">—</span>);

function IconAction({ label, icon: Icon, tone = 'text-blue-600 hover:bg-blue-50', onClick, disabled }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent ${tone}`}>
      <Icon className="w-4 h-4" />
    </button>
  );
}

function UserRow({ u, isMe, canManage, canAudit, open, onToggle, onAct }) {
  const multiple = u.activeSessions > 1;
  const ips = u.ips?.length ? u.ips : u.lastIp ? [u.lastIp] : [];
  const hosts = u.hosts?.length ? u.hosts : u.lastHost ? [u.lastHost] : [];
  const account = !u.isActive ? ['Deactivated', 'border-slate-300 text-slate-500 bg-slate-50']
    : lockedByAdmin(u) ? ['Locked', 'border-rose-300 text-rose-700 bg-rose-50']
      : lockedAfterFailures(u) ? ['Locked (attempts)', 'border-amber-300 text-amber-800 bg-amber-50']
        : ['Active', 'border-emerald-300 text-emerald-700 bg-emerald-50'];
  return (
    <tr className={`align-middle hover:bg-slate-50/70 ${multiple ? 'bg-amber-50/40' : ''}`}>
      <td className="px-3 py-2.5">
        <div className="font-semibold text-slate-900">{u.fullName}{isMe && <span className="ml-1.5 text-[10px] font-medium text-blue-700">(you)</span>}</div>
        <div className="text-xs text-slate-400 font-mono">{u.employeeCode}</div>
      </td>
      <td className="px-3 py-2.5 text-slate-700">
        {u.roles.length ? u.roles.map((r) => <div key={`${r.roleCode}-${r.plantId}`} className="text-sm leading-snug">{r.roleName}{r.plantName && <span className="text-xs text-slate-400"> · {r.plantName}</span>}</div>)
          : <span className="text-xs text-slate-400">No role</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${account[1]}`} title={lockedByAdmin(u) && u.lockedReason ? `Reason: ${u.lockedReason}` : undefined}>{account[0]}</span>
        {u.mustChangePassword && u.isActive && <div className="mt-1 text-[10px] font-medium text-amber-700">Temp password</div>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {u.online ? <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><span className="w-2 h-2 rounded-full bg-emerald-500" />Online</span>
          : <span className="inline-flex items-center gap-1.5 text-sm text-slate-400"><span className="w-2 h-2 rounded-full border border-slate-300" />Offline</span>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-sm text-slate-700" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : ''}>{u.lastLoginAt ? formatRelative(u.lastLoginAt) : <span className="text-xs text-slate-400">Never</span>}</td>
      <td className="px-3 py-2.5"><Stack items={ips} mono /></td>
      <td className="px-3 py-2.5"><Stack items={hosts.map((h) => String(h).toUpperCase())} /></td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1.5 cursor-pointer" title="Show sessions">
          <span className="font-semibold tabular text-slate-900">{u.activeSessions ?? 0}</span>
          {ips.length > 1 && <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">{ips.length} IPs</span>}
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-0.5">
          {canManage && <IconAction label="Edit details & roles" icon={Pencil} onClick={() => onAct('edit')} />}
          {canManage && (u.isActive
            ? <IconAction label="Deactivate account" icon={UserX} tone="text-rose-600 hover:bg-rose-50" disabled={isMe} onClick={() => onAct('active')} />
            : <IconAction label="Activate account" icon={UserCheck} tone="text-emerald-600 hover:bg-emerald-50" onClick={() => onAct('active')} />)}
          {canManage && (isLocked(u)
            ? <IconAction label="Unlock account" icon={LockOpen} tone="text-emerald-600 hover:bg-emerald-50" onClick={() => onAct('unlock')} />
            : <IconAction label="Lock account" icon={Lock} tone="text-amber-600 hover:bg-amber-50" disabled={isMe || !u.isActive} onClick={() => onAct('lock')} />)}
          {canManage && <IconAction label="Sign out everywhere" icon={LogOut} tone="text-orange-600 hover:bg-orange-50" disabled={isMe || !u.activeSessions} onClick={() => onAct('logout')} />}
          {canManage && <IconAction label="Reset password" icon={KeyRound} onClick={() => onAct('reset')} />}
          {canAudit ? <IconAction label="Activity log" icon={History} tone="text-slate-600 hover:bg-slate-100" onClick={() => onAct('log')} />
            : <IconAction label="Sessions" icon={MonitorSmartphone} tone="text-slate-600 hover:bg-slate-100" onClick={() => onAct('sessions')} />}
        </div>
      </td>
    </tr>
  );
}

/** A user's active sessions, opened under their row. */
function UserSessionsInline({ user, canManage, currentSessionId }) {
  const { data = [], isLoading } = useGetUserSessionsQuery(user.id, { refetchOnMountOrArgChange: true });
  const [end, { isLoading: ending, originalArgs }] = useEndSessionMutation();
  const active = data.filter((s) => s.active);
  const recent = data.filter((s) => !s.active).slice(0, 3);
  if (isLoading) return <div className="skeleton h-10" />;
  const stop = async (s) => {
    try {
      await end(s.id).unwrap();
      toast.success('Session ended');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <div>
      {active.length === 0 && <p className="py-2 text-xs text-slate-500">Not signed in anywhere right now.</p>}
      <ul className="divide-y divide-slate-100">
        {active.map((s) => <SessionRow key={s.id} s={s} mine={s.id === currentSessionId} canEnd={canManage && s.id !== currentSessionId} ending={ending && originalArgs === s.id} onEnd={() => stop(s)} />)}
      </ul>
      {recent.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-800 py-1">Recent ended sessions</summary>
          <ul className="divide-y divide-slate-100">{recent.map((s) => <SessionRow key={s.id} s={s} />)}</ul>
        </details>
      )}
    </div>
  );
}

/** Deactivate (signs out, no sign-in; data stays) or activate again. */
function ActiveDialog({ user, onClose }) {
  const [update, { isLoading }] = useUpdateUserMutation();
  const activate = !user.isActive;
  const confirm = async () => {
    try {
      await update({ id: user.id, isActive: activate, rowVersion: user.rowVersion }).unwrap();
      toast.success(`${user.fullName} ${activate ? 'activated' : 'deactivated'}`);
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <ConfirmDialog title={activate ? 'Activate account' : 'Deactivate account'} confirmLabel={activate ? 'Activate' : 'Deactivate'} variant={activate ? 'primary' : 'danger'}
      onConfirm={confirm} onCancel={onClose} busy={isLoading}
      message={activate ? `${user.fullName} can sign in again with their current password.` : `${user.fullName} is signed out everywhere and can no longer sign in. Their records and history stay; you can activate the account again later.`} />
  );
}

/** Every active session, most recent first; administrators end any of them. */
function SessionsTab({ canManage, currentSessionId }) {
  const { data: sessions = [], isLoading } = useGetActiveSessionsQuery(undefined, { pollingInterval: 30_000, refetchOnFocus: true });
  const [end, { isLoading: ending, originalArgs }] = useEndSessionMutation();
  const [multiOnly, setMultiOnly] = useState(false);
  const perUser = new Map();
  for (const s of sessions) perUser.set(s.userId, (perUser.get(s.userId) ?? 0) + 1);
  const shown = multiOnly ? sessions.filter((s) => perUser.get(s.userId) > 1) : sessions;
  const stop = async (s) => {
    try {
      await end(s.id).unwrap();
      toast.success(`Session of ${s.fullName} ended`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
        <p className="text-sm text-slate-600">{sessions.length} active session{sessions.length === 1 ? '' : 's'} of {perUser.size} user{perUser.size === 1 ? '' : 's'}; a green dot means active in the last 5 minutes.</p>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" className="accent-blue-600" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} />Only users on several devices
        </label>
      </div>
      {isLoading ? <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div> : shown.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">No active sessions.</p>
      ) : (
        <ul className="divide-y divide-slate-100 px-3">
          {shown.map((s) => (
            <SessionRow key={s.id} s={s} showUser mine={s.id === currentSessionId} canEnd={canManage && s.id !== currentSessionId} ending={ending && originalArgs === s.id} onEnd={() => stop(s)} />
          ))}
        </ul>
      )}
    </div>
  );
}

const from30Days = () => new Date(Date.now() - 30 * 86_400_000).toISOString();

/** Sign-ins, failures, sign-outs, locks and resets, newest first. */
function ActivityLog({ userId, users, onUser }) {
  const [event, setEvent] = useState('');
  const [page, setPage] = useState(1);
  const [from] = useState(from30Days); // fixed once, so the query does not change on every render
  const params = { from, page, pageSize: 50, ...(userId ? { actorId: userId } : {}), ...(event ? { event } : {}) };
  const { data, isFetching, error } = useGetAuthEventsQuery(params, { refetchOnMountOrArgChange: true });
  const who = users.find((u) => u.id === userId);
  const columns = [
    { key: 'at', header: 'When', render: (e) => <span className="whitespace-nowrap text-xs">{formatDateTime(e.at)}</span> },
    { key: 'event', header: 'Event', render: (e) => <Badge variant={(EVENTS[e.event] ?? [])[1] ?? 'neutral'}>{(EVENTS[e.event] ?? [e.event])[0]}</Badge> },
    { key: 'user', header: 'User', render: (e) => (e.fullName ? <span>{e.fullName} <span className="text-xs text-slate-400 font-mono">{e.employeeCode}</span></span> : <span className="font-mono text-xs text-slate-500">{e.employeeCode ?? '—'}</span>) },
    { key: 'ip', header: 'IP', render: (e) => <span className="font-mono text-xs">{e.ip ?? '—'}</span> },
    {
      key: 'detail', header: 'Detail',
      render: (e) => <span className="text-xs text-slate-500">{[e.detail?.reason && (FAIL_REASON[e.detail.reason] ?? e.detail.reason), e.detail?.failures && `attempt ${e.detail.failures}`, e.detail?.sessions !== undefined && `${e.detail.sessions} session(s)`, e.detail?.replacedSessions && `ended ${e.detail.replacedSessions} earlier session(s)`, e.detail?.host].filter(Boolean).join(' · ') || '—'}</span>,
    },
  ];
  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-56" aria-label="Event" placeholder="All events" value={event} onChange={(v) => { setEvent(v); setPage(1); }}
          options={Object.entries(EVENTS).map(([value, [label]]) => ({ value, label }))} />
        {who && <Badge variant="info" dot={false}>{who.fullName} <button type="button" onClick={() => onUser('')} className="ml-1 cursor-pointer" aria-label="Show everyone">×</button></Badge>}
        <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Activity className="w-3.5 h-3.5" />Last 30 days</span>
      </div>
      <DataTable tableId="signin-log" columns={columns} rows={data?.rows} loading={isFetching && !data} error={error} empty="Nothing in the activity log for these filters." />
      <Pagination meta={data?.meta} onPage={setPage} />
    </div>
  );
}

function EndAllDialog({ onClose }) {
  const [endAll, { isLoading }] = useEndAllSessionsMutation();
  const confirm = async () => {
    try {
      const r = await endAll().unwrap();
      toast.success(`${r.ended} session${r.ended === 1 ? '' : 's'} ended; everyone else must sign in again`);
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <ConfirmDialog title="Sign out everyone" confirmLabel="Sign out everyone" onConfirm={confirm} onCancel={onClose} busy={isLoading}
      message="Every user except you is signed out at their next click (for example before maintenance). Unsaved work in open forms may be lost; tablet data waiting to sync is kept." />
  );
}

/** Loads the full user (roles with end dates, current rowVersion) before editing. */
function EditUser({ id, lookups, onClose }) {
  const { data, isFetching } = useGetUserQuery(id, { refetchOnMountOrArgChange: true });
  if (!data || isFetching) {
    return (
      <Modal title="Edit user" onClose={onClose} size="sm">
        <Loader inline />
      </Modal>
    );
  }
  return <UserFormModal user={data} lookups={lookups} onClose={onClose} />;
}
