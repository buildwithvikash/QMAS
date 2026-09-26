import { ClipboardList, ExternalLink, FileSpreadsheet, FileWarning, FileX2, Image, Info, Play, Printer, SearchCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetImirQuery } from '../../api/imirApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Drawer, { DrawerCard } from '../../components/ui/Drawer.jsx';
import { formatDate, formatDateTime, formatQty } from '../../utils/format.js';
import { DeviationStage, DnStatus } from '../deviation/workflowUi.jsx';
import { currentStage, journeySteps, stageRows } from './journey.js';
import { ImirResult, ImirStatus } from './imirUi.jsx';

const TABS = [{ key: 'details', label: 'Details' }, { key: 'result', label: 'Inspection Result' }, { key: 'docs', label: 'Documents' }, { key: 'history', label: 'History' }];
const SECTIONS = [['DIMENSIONAL', 'Dimensional'], ['VISUAL', 'Visual'], ['RELIABILITY', 'Reliability']];

/** Quick look at a lot from the Incoming Lots list: details, result, documents and history. */
export default function ImirPreview({ id, onClose }) {
  const { data: m, isLoading } = useGetImirQuery(id);
  const [tab, setTab] = useState('details');
  const navigate = useNavigate();
  const open = () => navigate(`/imirs/${id}`);

  if (isLoading || !m) {
    return <Drawer title="Loading…" onClose={onClose}><div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}</div></Drawer>;
  }
  const can = (a) => m.allowedActions?.includes(a);
  const primary = can('inspect')
    ? { label: m.status === 'OPEN' ? 'Start inspection' : 'Continue inspection', icon: Play }
    : m.allowedActions?.some((a) => ['approve', 'revert', 'escalate', 'head_approve', 'hold'].includes(a)) ? { label: 'Review', icon: SearchCheck } : { label: 'Open IMIR', icon: ExternalLink };
  const opened = m.status !== 'AWAITING_FORMAT';
  const results = m.evaluation?.checkpointResults ?? {};

  return (
    <Drawer
      title={m.imirNo ?? 'IMIR (not opened)'}
      badge={<ImirStatus status={m.status} />}
      subtitle={<>GRN: {m.grnNo}<span className="mx-2 text-slate-300">|</span>Received: {formatDateTime(m.createdAt)}</>}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
      footer={(
        <>
          <Button icon={primary.icon} onClick={open}>{primary.label}</Button>
          {opened && m.imirNo && <a href={`/api/v1/imirs/${id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"><Printer className="w-4 h-4" />Print</a>}
          {opened && m.imirNo && <a href={`/api/v1/imirs/${id}/xlsx`} download className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="w-4 h-4 text-emerald-700" />Excel</a>}
        </>
      )}
    >
      {tab === 'details' && (
        <>
          <DrawerCard icon={Info} title="Lot information" rows={[
            ['IMIR No.', m.imirNo],
            ['GRN No.', `${m.grnNo} · ${formatDate(m.grnDate)}`],
            ['Item Code', m.itemCode],
            ['Item Description', m.itemDescription],
            ['Vendor', `${m.vendorName} (${m.vendorCode})`],
            ['Inward Qty.', formatQty(m.inwardQty, m.uom)],
            ['Sample Qty.', m.sampleSize],
            ['Plant', m.plantName],
            ['Invoice No.', m.invoiceNo],
            ['Drawing No.', m.drawingNo ? `${m.drawingNo}${m.drawingRev ? ` rev ${m.drawingRev}` : ''}` : null],
            ['Model', m.model],
          ]} />
          <DrawerCard icon={ClipboardList} title="Status & result" rows={[
            ['Current status', <ImirStatus key="s" status={m.status} />],
            ['Stage', (() => { const c = currentStage(journeySteps({ status: m.status, history: m.history, deviation: m.deviation })); return c ? `${c.label}${c.holder ? ` · with ${c.holder}` : ''}` : null; })()],
            ['Inspection date', m.submittedAt ? formatDateTime(m.submittedAt) : m.inspectionStartedAt ? `Started ${formatDateTime(m.inspectionStartedAt)}` : null],
            ['Inspector', m.submittedByName ?? m.inspectedByName],
            ['Result', m.result ? <ImirResult key="r" result={m.result} /> : null],
            ['Remarks', m.inspectorRemark],
            m.status === 'AWAITING_FORMAT' ? ['Waiting for', m.awaitingReason] : null,
          ]} />
        </>
      )}

      {tab === 'result' && (
        !opened ? <p className="text-sm text-slate-500 p-2">This lot opens once its item has an approved inspection format.</p> : (
          <>
            {SECTIONS.map(([sec, label]) => {
              const cps = m.checkpoints.filter((c) => c.section === sec);
              if (!cps.length) return null;
              const nok = cps.filter((c) => results[c.uid] === 'NOK');
              const ok = cps.filter((c) => results[c.uid] === 'OK').length;
              return (
                <DrawerCard key={sec} title={`${label} · ${cps.length} check${cps.length === 1 ? '' : 's'}`}
                  action={<span className="text-xs"><span className="text-emerald-700 font-semibold">{ok} OK</span>{nok.length > 0 && <span className="ml-2 text-rose-700 font-semibold">{nok.length} NOK</span>}{cps.length - ok - nok.length > 0 && <span className="ml-2 text-slate-500">{cps.length - ok - nok.length} pending</span>}</span>}>
                  <ul className="px-4 pb-3 space-y-1">
                    {cps.map((c) => {
                      const vals = m.cells.filter((x) => x.checkpointUid === c.uid).sort((a, b) => a.sampleNo - b.sampleNo)
                        .map((x) => (x.value ?? (x.ok === true ? 'OK' : x.ok === false ? 'NOK' : null))).filter((v) => v !== null);
                      const r = results[c.uid];
                      return (
                        <li key={c.uid} className="flex items-baseline gap-2 text-sm">
                          <span className={`w-10 shrink-0 text-xs font-bold ${r === 'NOK' ? 'text-rose-700' : r === 'OK' ? 'text-emerald-700' : 'text-slate-400'}`}>{r ?? '—'}</span>
                          <span className="min-w-0 flex-1"><span className="text-slate-900">{c.checkpoint}</span>{c.section === 'DIMENSIONAL' && <span className="text-xs text-slate-400"> {c.lsl ?? '–'}…{c.usl ?? '–'} {c.uom ?? ''}</span>}
                            {vals.length > 0 && <span className="block text-xs text-slate-500 tabular">{vals.join(' · ')}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </DrawerCard>
              );
            })}
            {m.evaluation?.missing?.length > 0 && <p className="text-xs text-amber-700 px-1">{m.evaluation.missing.length} required entr{m.evaluation.missing.length === 1 ? 'y is' : 'ies are'} still missing.</p>}
          </>
        )
      )}

      {tab === 'docs' && (
        <DrawerCard title="Documents & linked records">
          <ul className="px-4 pb-3 divide-y divide-slate-100 text-sm">
            {opened && m.imirNo && (
              <>
                <li className="py-2 flex items-center gap-2"><Printer className="w-4 h-4 text-slate-400" /><a className="text-blue-700 hover:underline" href={`/api/v1/imirs/${id}/pdf`} target="_blank" rel="noreferrer">Inspection report (PDF)</a></li>
                <li className="py-2 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /><a className="text-blue-700 hover:underline" href={`/api/v1/imirs/${id}/xlsx`} download>Inspection report (Excel)</a></li>
              </>
            )}
            <li className="py-2 flex items-center gap-2"><Image className="w-4 h-4 text-slate-400" />{m.attachments?.length ?? 0} photo{m.attachments?.length === 1 ? '' : 's'} on the inspection</li>
            {m.formatVersionId && <li className="py-2 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-slate-400" /><Link className="text-blue-700 hover:underline" to={`/formats/versions/${m.formatVersionId}`}>Inspection format {m.formatNo ?? ''} (v{m.formatVersionNo})</Link></li>}
            {m.deviation && <li className="py-2 flex items-center gap-2"><FileWarning className="w-4 h-4 text-slate-400" /><Link className="text-blue-700 hover:underline" to={`/deviations/${m.deviation.id}`}>{m.deviation.deviationNo}</Link><DeviationStage stage={m.deviation.stage} outcome={m.deviation.outcome} /></li>}
            {m.dn && <li className="py-2 flex items-center gap-2"><FileX2 className="w-4 h-4 text-slate-400" /><Link className="text-blue-700 hover:underline" to={`/dns/${m.dn.id}`}>{m.dn.dnNo}</Link><DnStatus status={m.dn.status} /></li>}
          </ul>
        </DrawerCard>
      )}

      {tab === 'history' && <PreviewHistory rows={stageRows({ history: m.history, current: currentStage(journeySteps({ status: m.status, history: m.history, deviation: m.deviation })), start: { stage: 'SAP receipt', at: m.createdAt, status: 'Received' } })} />}
    </Drawer>
  );
}

const TONE = { good: 'success', bad: 'danger', warn: 'warning', esc: 'warning', info: 'info', pending: 'neutral' };

/** Stage history as a compact timeline for the preview drawers. rows from stageRows(). */
export function PreviewHistory({ rows }) {
  if (!rows.length) return <p className="text-sm text-slate-500 p-2">No steps yet.</p>;
  return (
    <section className="card p-4">
      <ol className="relative ml-2 border-l-2 border-slate-100 space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="ml-4">
            <span className={`absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full ring-2 ring-white ${r.pending ? 'bg-white border-2 border-blue-500' : r.tone === 'bad' ? 'bg-rose-500' : r.tone === 'good' ? 'bg-emerald-500' : r.tone === 'warn' || r.tone === 'esc' ? 'bg-amber-500' : 'bg-blue-500'}`} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{r.stage}</span>
              <Badge variant={TONE[r.tone] ?? 'neutral'}>{r.status}</Badge>
            </div>
            <p className="text-xs text-slate-500">{r.user ?? 'Waiting'}{r.role ? ` · ${r.role}` : ''}{r.at ? ` · ${formatDateTime(r.at)}` : ''}</p>
            {r.remark && <p className="mt-0.5 text-xs text-slate-700 italic">“{r.remark}”</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
