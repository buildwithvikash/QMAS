import { EXTERNAL_ACCESS_MAX_DAYS, isCidr } from '@qmas/shared';
import { AlertTriangle, Building2, Globe, Plus, Save, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useGetUsersQuery } from '../../api/adminApi.js';
import {
  useGetExternalAccessQuery, useGetNetworkSettingsQuery, useGrantExternalAccessMutation, useRevokeExternalAccessMutation, useSaveNetworkSettingsMutation,
} from '../../api/networkApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError, TextArea, TextInput } from '../../components/ui/fields.jsx';
import { SearchBox } from '../../components/ui/ListFilters.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';
import { done } from '../../utils/notify.jsx';

const STATE = { ACTIVE: ['Active', 'success'], UPCOMING: ['Upcoming', 'info'], EXPIRED: ['Ended', 'neutral'], REVOKED: ['Revoked', 'danger'] };
const DAY = 86_400_000;

/** A Date as the value of a datetime-local input (local time). */
const localInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Network access control: QMAS works only from the company network (the ranges below). Users who
 * must work from outside get external access for a set period, with a reason; it ends by itself.
 * Every grant and revocation is kept as the audit trail.
 */
export default function NetworkAccessPage() {
  const [state, setState] = useState('ACTIVE');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const search = useDebounced(q);
  const { data, isFetching, error } = useGetExternalAccessQuery({ page, pageSize, ...(state !== 'ALL' && { state }), ...(search && { q: search }) });

  const columns = [
    { key: 'user', header: 'User', text: (g) => `${g.userName} (${g.employeeCode})`, render: (g) => <div><div className="font-semibold text-slate-900">{g.userName}</div><div className="text-xs text-slate-500">{g.employeeCode}</div></div> },
    {
      key: 'period', header: 'Access period', text: (g) => `${formatDateTime(g.startsAt)} – ${formatDateTime(g.endsAt)}`,
      render: (g) => <div className="whitespace-nowrap text-xs"><div>From {formatDateTime(g.startsAt)}</div><div>To {formatDateTime(g.endsAt)}</div><div className="text-slate-400">{duration(g.startsAt, g.endsAt)}</div></div>,
    },
    { key: 'reason', header: 'Reason', text: (g) => g.reason, render: (g) => <span className="line-clamp-2 max-w-xs text-slate-700">{g.reason}</span> },
    { key: 'grantedBy', header: 'Approved by', text: (g) => `${g.grantedByName} ${formatDateTime(g.grantedAt)}`, render: (g) => <div><div>{g.grantedByName}</div><div className="text-xs text-slate-500 whitespace-nowrap">{formatDateTime(g.grantedAt)}</div></div> },
    {
      key: 'revoked', header: 'Revoked', text: (g) => (g.revokedAt ? `${g.revokedByName} ${formatDateTime(g.revokedAt)} ${g.revokeReason ?? ''}` : ''),
      render: (g) => (g.revokedAt ? <div className="text-xs"><div>{g.revokedByName} · {formatDateTime(g.revokedAt)}</div><div className="text-slate-600">{g.revokeReason}</div></div> : '—'),
    },
    { key: 'state', header: 'Status', text: (g) => STATE[g.state][0], render: (g) => <Badge variant={STATE[g.state][1]} dot={g.state === 'ACTIVE'}>{STATE[g.state][0]}</Badge> },
  ];
  const rowMenu = (g) => (g.state === 'ACTIVE' || g.state === 'UPCOMING' ? [{ label: 'Revoke access', icon: XCircle, onClick: () => setRevoking(g) }] : []);

  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Network Access" subtitle="QMAS works only from the company network. Approve access from outside for a user and a set period; it ends by itself. Every approval is kept.">
        <Button icon={Plus} onClick={() => setGranting(true)}>Grant external access</Button>
      </PageHeader>
      <div className="p-5 space-y-4">
        <CompanyNetwork />
        <section className="space-y-3">
          <h2 className="section-title">External access (audit trail)</h2>
          <Tabs active={state} onChange={(s) => { setState(s); setPage(1); }}
            tabs={[{ key: 'ACTIVE', label: 'Active' }, { key: 'UPCOMING', label: 'Upcoming' }, { key: 'EXPIRED', label: 'Ended' }, { key: 'REVOKED', label: 'Revoked' }, { key: 'ALL', label: 'All' }]} />
          <DataTable
            columns={columns}
            rows={data?.rows}
            loading={isFetching}
            error={error}
            rowMenu={rowMenu}
            exportName="external-access"
            empty={state === 'ACTIVE' ? 'Nobody has external access right now.' : 'Nothing here.'}
            pagination={data?.meta && { meta: data.meta, onPage: setPage, onPageSize: (n) => { setPageSize(n); setPage(1); } }}
            leading={<SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="User, code or reason…" />}
          />
        </section>
      </div>
      {granting && <GrantDialog onClose={() => setGranting(false)} />}
      {revoking && <RevokeDialog grant={revoking} onClose={() => setRevoking(null)} />}
    </div>
  );
}

function duration(from, to) {
  const h = Math.round((new Date(to) - new Date(from)) / 3_600_000);
  return h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`;
}

/** The company network ranges, and where the admin is connecting from. */
function CompanyNetwork() {
  const { data: s } = useGetNetworkSettingsQuery();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [save, { isLoading }] = useSaveNetworkSettingsMutation();
  useEffect(() => { if (s) setText(s.internalNetworks.join('\n')); }, [s]);
  if (!s) return null;
  const lines = text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  const wrong = lines.filter((x) => !isCidr(x));
  const changed = lines.join('\n') !== s.internalNetworks.join('\n');
  const submit = async () => {
    setError(null);
    if (wrong.length) return setError(`Not an address or range: ${wrong.join(', ')}`);
    try {
      await save({ internalNetworks: lines, rowVersion: s.rowVersion }).unwrap();
      done('Company network saved. It applies to every request from now on.');
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  const external = s.yourNetwork === 'EXTERNAL';
  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="section-title">Company network</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${external ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
          {external ? <Globe className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
          You: {s.yourIp ?? 'unknown'} · {external ? 'outside' : 'company network'}
        </span>
        {s.updatedByName && <span className="ml-auto text-xs text-slate-500">Changed by {s.updatedByName} · {formatDateTime(s.updatedAt)}</span>}
      </div>
      {s.forcedOff && (
        <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />The check is switched off on the server (NETWORK_ACCESS_ENFORCE=false), so QMAS is open from anywhere. Remove that setting to turn it back on.
        </p>
      )}
      <p className="text-sm text-slate-600">Addresses and ranges that count as the company network, one per line (for example <code>10.0.0.0/8</code>, or the office's public address like <code>203.0.113.7</code>). Anyone connecting from elsewhere is refused unless they have external access below.</p>
      <FormError message={error} />
      <TextArea label="Company network ranges" value={text} onChange={(e) => setText(e.target.value)} rows={5} className="[&_textarea]:font-mono" />
      <div className="flex items-center justify-end gap-3">
        {wrong.length > 0 && <span className="text-xs text-rose-600">{wrong.length} line{wrong.length === 1 ? '' : 's'} not valid</span>}
        <Button icon={Save} size="sm" loading={isLoading} disabled={!changed} onClick={submit}>Save ranges</Button>
      </div>
    </section>
  );
}

function GrantDialog({ onClose }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data: users } = useGetUsersQuery({ page: 1, pageSize: 8, isActive: 'true', ...(search && { q: search }) });
  const [user, setUser] = useState(null);
  const now = new Date();
  const [startsAt, setStartsAt] = useState(localInput(now));
  const [endsAt, setEndsAt] = useState(localInput(new Date(now.getTime() + DAY)));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [grant, { isLoading }] = useGrantExternalAccessMutation();
  const preset = (days) => setEndsAt(localInput(new Date(new Date(startsAt).getTime() + days * DAY)));
  const save = async () => {
    setError(null);
    if (!user) return setError('Choose the user.');
    if (!reason.trim()) return setError('Enter the reason for external access.');
    try {
      await grant({ userId: user.id, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), reason: reason.trim() }).unwrap();
      done(`External access approved for ${user.fullName}. They have been notified.`);
      onClose();
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  return (
    <Modal title="Grant external access" subtitle={`At most ${EXTERNAL_ACCESS_MAX_DAYS} days; it ends by itself`} onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Approve access" />}>
      <FormError message={error} />
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-[11px] font-medium text-slate-500">User <span className="text-rose-500">*</span></p>
          {user ? (
            <div className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm">
              <span className="font-semibold text-slate-900">{user.fullName}</span><span className="text-slate-500">{user.employeeCode}</span>
              <button type="button" onClick={() => setUser(null)} className="ml-auto text-xs font-semibold text-blue-700 hover:underline cursor-pointer">Change</button>
            </div>
          ) : (
            <>
              <SearchBox value={q} onChange={setQ} placeholder="Name or employee code…" />
              <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
                {(users?.rows ?? []).map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => setUser(u)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 cursor-pointer">
                      <span className="font-medium text-slate-900">{u.fullName}</span><span className="text-xs text-slate-500">{u.employeeCode}</span>
                    </button>
                  </li>
                ))}
                {users && !users.rows.length && <li className="px-3 py-2 text-sm text-slate-500">No active user matches.</li>}
              </ul>
            </>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="From" required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <TextInput label="Until" required type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="self-center text-slate-500">Length:</span>
          {[[1, '1 day'], [3, '3 days'], [7, '1 week'], [30, '30 days']].map(([d, l]) => (
            <button key={d} type="button" onClick={() => preset(d)} className="rounded-full border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">{l}</button>
          ))}
        </div>
        <TextArea label="Reason for external access" required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. Audit at vendor site, working from the Pune office" />
      </div>
    </Modal>
  );
}

function RevokeDialog({ grant, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [revoke, { isLoading }] = useRevokeExternalAccessMutation();
  const save = async () => {
    setError(null);
    if (!reason.trim()) return setError('Enter the reason for revoking.');
    try {
      await revoke({ id: grant.id, reason: reason.trim() }).unwrap();
      done(`External access of ${grant.userName} revoked. It stops at once.`);
      onClose();
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  return (
    <Modal title="Revoke external access" subtitle={`${grant.userName} · until ${formatDateTime(grant.endsAt)}`} size="sm" onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Revoke" saveVariant="danger" />}>
      <FormError message={error} />
      <p className="mb-3 text-sm text-slate-600">The user can no longer work from outside the company network, from their next request on.</p>
      <TextArea label="Reason for revoking" required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
    </Modal>
  );
}
