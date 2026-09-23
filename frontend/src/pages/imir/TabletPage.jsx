import { AlertTriangle, CloudOff, Download, RefreshCw, Tablet, Wifi } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useGetImirsQuery } from '../../api/imirApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import * as engine from '../../offline/engine.js';
import { formatDateTime, formatQty, formatRelative } from '../../utils/format.js';

/**
 * The inspector's tablet: register it once with its device code, take lots onto it, inspect them
 * with or without a connection, and see what is still waiting to be sent.
 */
export default function TabletPage() {
  const [s, setS] = useState(null);
  const load = useCallback(() => engine.status().then(setS), []);
  useEffect(() => {
    load();
    return engine.subscribe(load);
  }, [load]);
  if (!s) return <Loader />;
  return s.device ? <TabletHome s={s} /> : <SetupTablet />;
}

function SetupTablet() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setup = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await engine.registerThisTablet(code);
      toast.success(`This tablet is ${d.deviceCode} (${d.plantName})`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader icon={Tablet} title="Set up this tablet" subtitle="Needed once, so lots can be inspected without a network" />
      <form onSubmit={setup} className="p-5 max-w-md space-y-4">
        <p className="text-sm text-slate-600">Enter the device code the administrator registered for this tablet (Administration → Tablets). It links the tablet to its plant.</p>
        <TextInput label="Device code" required autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} error={error} placeholder="e.g. TAB-SJN-01" />
        <Button type="submit" size="lg" loading={busy} disabled={!code.trim()}>Set up</Button>
      </form>
    </div>
  );
}

function TabletHome({ s }) {
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();
  const pending = s.pendingOps + s.pendingFiles;

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await engine.syncNow();
      if (r.offline) toast('No connection. Entries stay on the tablet.', { icon: '📴' });
      else toast.success(`Synced: ${r.sent} sent${r.refused ? `, ${r.refused} not accepted` : ''}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <PageHeader icon={Tablet} title={`This tablet · ${s.device.code}`} subtitle={`${s.device.name} · ${s.device.plantSapCode} ${s.device.plantName}`}>
        {s.online ? <Badge variant="success"><Wifi className="w-3 h-3" />Online</Badge> : <Badge variant="warning"><CloudOff className="w-3 h-3" />Offline</Badge>}
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={syncing} disabled={!s.online} onClick={syncNow}>Sync now</Button>
      </PageHeader>
      <div className="p-5 space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Lots on this tablet" value={s.bundles.length} />
          <Stat label="Waiting to send" value={pending} tone={pending ? 'warning' : 'ok'} hint={s.pendingFiles ? `${s.pendingFiles} photo(s)` : undefined} />
          <Stat label="Last sync" value={s.lastSyncAt ? formatRelative(s.lastSyncAt) : 'never'} hint={s.lastSyncAt ? formatDateTime(s.lastSyncAt) : undefined} />
        </div>

        {s.orphanAttention.length > 0 && (
          <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-rose-800"><AlertTriangle className="w-4 h-4" />Needs attention</h2>
            <ul className="mt-2 space-y-1 text-sm text-rose-800">
              {s.orphanAttention.map((a, i) => <li key={i}>{formatDateTime(a.at)}: {a.message}</li>)}
            </ul>
            <button type="button" onClick={engine.clearOrphanAttention} className="mt-2 text-xs font-semibold text-rose-700 underline cursor-pointer">Clear</button>
          </section>
        )}

        <section>
          <h2 className="text-sm font-bold text-slate-800 mb-2">On this tablet</h2>
          {s.bundles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No lots yet. Take lots below while you have a connection; you can then inspect them offline.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {s.bundles.map((b) => (
                <article key={b.id} className={`rounded-xl border bg-white p-4 ${b.attention ? 'border-rose-300' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-sm font-bold text-slate-800">{b.imirNo}</div>
                      <div className="text-sm text-slate-600">{b.itemCode} · {b.itemDescription}</div>
                      <div className="text-xs text-slate-400">{b.vendorName} · {formatQty(b.inwardQty, b.uom)} · sample {b.sampleSize}</div>
                    </div>
                    {b.pendingSubmit ? <Badge variant="info">Submit queued</Badge> : b.attention ? <Badge variant="danger">Needs attention</Badge> : s.pendingByImir[b.id] ? <Badge variant="warning">{s.pendingByImir[b.id]} to send</Badge> : <Badge variant="success">Up to date</Badge>}
                  </div>
                  {b.attention && <p className="mt-2 text-xs text-rose-700">{b.attention}</p>}
                  <div className="mt-3 flex gap-2">
                    <Button size="lg" className="flex-1" onClick={() => navigate(`/imirs/${b.id}`)}>{b.pendingSubmit ? 'View' : 'Inspect'}</Button>
                    {!b.pendingSubmit && (
                      <Button size="lg" variant="ghost" onClick={() => engine.release(b.id).then(() => toast.success('Lot released')).catch((e) => toast.error(e.message))}>Release</Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {s.online && <TakeLots device={s.device} onTablet={new Set(s.bundles.map((b) => b.id))} />}
        <p className="text-xs text-slate-400">
          Entries are saved on the tablet first and sent automatically when there is a connection. Do not clear the browser data of this tablet while entries are waiting.
          {' '}<Link to="/imirs" className="underline">All incoming lots</Link>
        </p>
      </div>
    </div>
  );
}

const Stat = ({ label, value, hint, tone }) => (
  <div className={`rounded-xl border bg-white p-4 ${tone === 'warning' ? 'border-amber-300' : 'border-slate-200'}`}>
    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</div>
    <div className="text-2xl font-bold text-slate-800 tabular">{value}</div>
    {hint && <div className="text-xs text-slate-400">{hint}</div>}
  </div>
);

function TakeLots({ device, onTablet }) {
  const { data, isFetching, refetch } = useGetImirsQuery({ statusGroup: 'TO_INSPECT', plantId: device.plantId, pageSize: 50, sort: 'createdAt', order: 'asc' });
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const rows = (data?.rows ?? []).filter((r) => !onTablet.has(r.id));
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const take = async () => {
    setBusy(true);
    try {
      const res = await engine.checkout([...picked]);
      toast.success(`${res.checkedOut.length} lot(s) now on this tablet`);
      res.refused.forEach((r) => toast.error(r.reason));
      setPicked(new Set());
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-slate-800">Lots to inspect at {device.plantName}</h2>
        <Button size="sm" icon={Download} disabled={!picked.size} loading={busy} onClick={take}>Take {picked.size || ''} onto this tablet</Button>
      </div>
      {isFetching && !data ? <Loader /> : rows.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing waiting for inspection.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {rows.map((r) => {
            const elsewhere = r.checkoutDeviceId && r.checkoutDeviceId !== device.id;
            return (
              <li key={r.id}>
                <label className={`flex items-center gap-3 px-4 py-3 ${elsewhere ? 'opacity-50' : 'cursor-pointer'}`}>
                  <input type="checkbox" className="w-5 h-5 accent-blue-600" disabled={elsewhere} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-mono text-xs font-semibold">{r.imirNo}</span>
                    <span className="block text-sm truncate">{r.itemCode} · {r.itemDescription}</span>
                    <span className="block text-xs text-slate-400">{r.vendorName} · {formatQty(r.inwardQty, r.uom)} · sample {r.sampleSize}</span>
                  </span>
                  {elsewhere && <Badge variant="neutral">On {r.checkoutDeviceCode}</Badge>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
