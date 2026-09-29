import {
  Activity, AlertTriangle, Bug, CheckCircle2, Cpu, Database, HardDrive, Mail, RefreshCw, RotateCcw, Server, Users, Workflow, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useGetSystemHealthQuery, useRetryFailedMailMutation } from '../../api/systemApi.js';
import Button from '../../components/ui/Button.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';

const fmtBytes = (b) => {
  if (b === null || b === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(b);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};
const fmtDuration = (sec) => {
  if (sec === null || sec === undefined) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};

const STATE = {
  OK: { label: 'All systems running', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: CheckCircle2 },
  WARNING: { label: 'Running, with warnings', tone: 'border-amber-200 bg-amber-50 text-amber-900', icon: AlertTriangle },
  DOWN: { label: 'Something is not running', tone: 'border-rose-200 bg-rose-50 text-rose-800', icon: XCircle },
};

const Dot = ({ ok, warn }) => <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : warn ? 'bg-amber-500' : 'bg-rose-500'}`} />;

function Tile({ icon: Icon, tone, title, status, children, action }) {
  return (
    <section className="card flex flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${tone}`}><Icon className="h-4.5 w-4.5" /></span>
        <h2 className="section-title">{title}</h2>
        <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-600">{status}</span>
      </div>
      <dl className="flex-1 space-y-1.5 px-4 pb-3 text-sm">{children}</dl>
      {action && <div className="border-t border-slate-100 px-4 py-2.5">{action}</div>}
    </section>
  );
}

const Row = ({ label, children, tone }) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className="text-slate-500">{label}</dt>
    <dd className={`text-right font-medium tabular ${tone ?? 'text-slate-800'}`}>{children ?? '—'}</dd>
  </div>
);

/** Whether QMAS is running well: processes, database, mail, SAP, errors, storage and sessions. */
export default function SystemHealthPage() {
  const { data: h, isFetching, error, refetch, fulfilledTimeStamp } = useGetSystemHealthQuery(undefined, { pollingInterval: 30_000 });
  const [retry, retryState] = useRetryFailedMailMutation();

  if (!h && isFetching) return <Loader />;
  if (error && !h) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  const state = STATE[h.status];
  const workers = h.processes.filter((p) => p.kind === 'WORKER');
  const apis = h.processes.filter((p) => p.kind === 'API');
  const workerAlive = workers.some((w) => w.alive);
  const diskUsed = h.storage.disk ? 1 - h.storage.disk.freeBytes / h.storage.disk.totalBytes : null;

  const retryMail = async () => {
    try {
      const r = await retry().unwrap();
      toast.success(r.requeued ? `${r.requeued} mail${r.requeued === 1 ? '' : 's'} queued again` : 'No failed mail to retry');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader icon={Activity} title="System Health" subtitle="Whether QMAS is running well. Refreshes every 30 seconds.">
        <span className="text-xs text-slate-400">Checked {fulfilledTimeStamp ? formatRelative(new Date(fulfilledTimeStamp)) : ''}</span>
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={isFetching} onClick={refetch}>Refresh</Button>
      </PageHeader>
      <div className="p-5 space-y-4">
        <div className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 ${state.tone}`}>
          <state.icon className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{state.label}</p>
            {h.problems.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm">
                {h.problems.map((p) => <li key={p.text} className="flex items-center gap-2"><Dot ok={false} warn={p.level === 'warning'} />{p.text}</li>)}
              </ul>
            )}
          </div>
          <Link to="/admin/error-log" className="text-sm font-semibold underline-offset-2 hover:underline">Open the error log</Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Tile icon={Server} tone="bg-blue-100 text-blue-700" title="API server" status={<><Dot ok />Running</>}>
            <Row label="Version">{h.api.version}</Row>
            <Row label="Up for">{fmtDuration(h.api.uptimeSec)}</Row>
            <Row label="Memory">{h.api.rssMb} MB</Row>
            <Row label="Node / environment">{h.api.node} · {h.api.env}</Row>
            <Row label="API processes">{apis.filter((a) => a.alive).length || 1}</Row>
          </Tile>

          <Tile icon={Workflow} tone="bg-violet-100 text-violet-700" title="Background worker"
            status={<><Dot ok={workerAlive} />{workerAlive ? 'Running' : workers.length ? 'Stopped' : 'Not started'}</>}>
            {workers.length === 0 && <p className="text-sm text-slate-500">Not started. Without it there are no SAP pulls, reminders or mail. Start it with <code className="rounded bg-slate-100 px-1 text-xs">npm -w @qmas/backend run worker</code>.</p>}
            {workers.slice(0, 3).map((w) => (
              <div key={w.component} className="rounded-lg bg-slate-50 px-3 py-2">
                <Row label={`${w.host} · pid ${w.pid}`} tone={w.alive ? 'text-emerald-700' : 'text-rose-700'}>{w.alive ? 'running' : w.stopped ? 'stopped' : 'not responding'}</Row>
                <Row label="Last signal">{formatRelative(w.lastBeat)}</Row>
                <Row label="Started">{formatDateTime(w.startedAt)}</Row>
              </div>
            ))}
          </Tile>

          <Tile icon={Database} tone="bg-sky-100 text-sky-700" title="Database" status={<><Dot ok={h.database.latencyMs < 500} warn />{h.database.latencyMs < 500 ? 'Connected' : 'Slow'}</>}>
            <Row label="Response time">{h.database.latencyMs} ms</Row>
            <Row label="Size">{fmtBytes(h.database.sizeBytes)}</Row>
            <Row label="Connections">{h.database.connections} of {h.database.maxConnections}</Row>
            <Row label="Server"><span className="text-xs">{h.database.version}</span></Row>
          </Tile>

          <Tile icon={Mail} tone="bg-amber-100 text-amber-700" title="Mail"
            status={<><Dot ok={h.mail.failed === 0} warn={h.mail.failed > 0} />{h.mail.failed ? `${h.mail.failed} failed` : 'OK'}</>}
            action={h.mail.failed > 0 && <Button size="sm" variant="secondary" icon={RotateCcw} loading={retryState.isLoading} onClick={retryMail}>Retry failed mails</Button>}>
            <Row label="Sending mode">{h.mail.transport === 'smtp' ? 'SMTP (real mail)' : 'Log only (no mail sent)'}</Row>
            <Row label="Waiting to send" tone={h.mail.oldestPendingSec > 1800 ? 'text-amber-700' : undefined}>{h.mail.pending}{h.mail.pending ? ` · oldest ${fmtDuration(h.mail.oldestPendingSec)}` : ''}</Row>
            <Row label="Sent in 24 h">{h.mail.sent24h}</Row>
            <Row label="Failed" tone={h.mail.failed ? 'text-rose-700' : undefined}>{h.mail.failed}</Row>
            {h.mail.lastError && <p className="truncate rounded bg-rose-50 px-2 py-1 text-xs text-rose-700" title={h.mail.lastError}>Last error: {h.mail.lastError}</p>}
          </Tile>

          <Tile icon={RefreshCw} tone="bg-emerald-100 text-emerald-700" title="SAP sync"
            status={h.sap ? <><Dot ok={h.sap.state === 'CONNECTED'} warn={h.sap.state === 'DELAYED' || h.sap.state === 'NEVER'} />{{ CONNECTED: 'Connected', DELAYED: 'Late', FAILING: 'Failing', NEVER: 'No pull yet' }[h.sap.state]}</> : '—'}
            action={<Link to="/admin/sap-sync" className="text-xs font-semibold text-blue-700 hover:underline">Open SAP Sync</Link>}>
            <Row label="Mode">{h.sap?.mode ?? '—'}</Row>
            <Row label="Last pull">{h.sap?.lastAt ? formatRelative(h.sap.lastAt) : 'never'}</Row>
            <Row label="Every">{h.sap?.intervalMin} min</Row>
            <Row label="Pulls in 24 h">{h.sap?.last24h?.pulls ?? 0}{h.sap?.last24h?.withProblems ? ` · ${h.sap.last24h.withProblems} with problems` : ''}</Row>
          </Tile>

          <Tile icon={Bug} tone="bg-rose-100 text-rose-700" title="Errors"
            status={<><Dot ok={h.errors.open === 0} warn={h.errors.lastHour < 10} />{h.errors.open ? `${h.errors.open} open` : 'None open'}</>}
            action={<Link to="/admin/error-log" className="text-xs font-semibold text-blue-700 hover:underline">Open the error log</Link>}>
            <Row label="Last hour" tone={h.errors.lastHour >= 10 ? 'text-rose-700' : undefined}>{h.errors.lastHour}</Row>
            <Row label="Last 24 h">{h.errors.last24h}</Row>
            <Row label="Server / worker / browser">{h.errors.server24h} / {h.errors.worker24h} / {h.errors.client24h}</Row>
          </Tile>

          <Tile icon={HardDrive} tone="bg-slate-200 text-slate-700" title="Storage"
            status={diskUsed !== null ? <><Dot ok={diskUsed < 0.9} warn />{Math.round(diskUsed * 100)}% disk used</> : '—'}>
            <Row label="Photos and files">{fmtBytes(h.storage.uploads.bytes)} · {h.storage.uploads.files} files</Row>
            <Row label="Log files">{fmtBytes(h.storage.logs.bytes)} · {h.storage.logs.files} files</Row>
            {h.storage.disk && <Row label="Free disk">{fmtBytes(h.storage.disk.freeBytes)} of {fmtBytes(h.storage.disk.totalBytes)}</Row>}
            <p className="truncate pt-1 text-[11px] text-slate-400" title={h.storage.logDir}>Logs: {h.storage.logDir}</p>
          </Tile>

          <Tile icon={Users} tone="bg-indigo-100 text-indigo-700" title="Users online" status={<><Dot ok />{h.sessions.users} signed in</>}
            action={<Link to="/admin/users" className="text-xs font-semibold text-blue-700 hover:underline">Open Users</Link>}>
            <Row label="Active sessions (30 min)">{h.sessions.active}</Row>
            <Row label="People">{h.sessions.users}</Row>
          </Tile>

          <Tile icon={Cpu} tone="bg-teal-100 text-teal-700" title="Alerts" status="Every 5 min">
            <p className="text-sm text-slate-600">People with the <span className="font-semibold">System monitoring</span> permission get a bell notice (and mail, while the worker runs) when:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-600">
              <li>the worker stops</li>
              <li>3 or more mails fail in an hour</li>
              <li>10 or more errors in 15 minutes</li>
            </ul>
            <p className="text-xs text-slate-400">At most one notice per kind each hour.</p>
          </Tile>
        </div>
      </div>
    </div>
  );
}
