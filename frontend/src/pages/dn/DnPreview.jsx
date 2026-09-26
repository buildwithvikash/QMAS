import { ClipboardList, ExternalLink, FileSpreadsheet, FileWarning, Info, PackageOpen, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetDnQuery } from '../../api/dnApi.js';
import Button from '../../components/ui/Button.jsx';
import Drawer, { DrawerCard } from '../../components/ui/Drawer.jsx';
import { formatDate, formatDateTime, formatQty } from '../../utils/format.js';
import { DnStatus } from '../deviation/workflowUi.jsx';
import { currentStage, dnSteps, stageRows } from '../imir/journey.js';
import { PreviewHistory } from '../imir/ImirPreview.jsx';

const TABS = [{ key: 'details', label: 'Details' }, { key: 'docs', label: 'Documents' }, { key: 'history', label: 'History' }];

/** Quick look at a DN from the register: lot, defect, CAPA status and history. */
export default function DnPreview({ id, onClose }) {
  const { data: dn, isLoading } = useGetDnQuery(id);
  const [tab, setTab] = useState('details');
  const navigate = useNavigate();

  if (isLoading || !dn) {
    return <Drawer title="Loading…" onClose={onClose}><div className="space-y-3">{[1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div></Drawer>;
  }
  const current = currentStage(dnSteps(dn));

  return (
    <Drawer
      title={dn.dnNo}
      badge={<DnStatus status={dn.status} overdue={dn.capaOverdue} />}
      subtitle={<>IMIR: {dn.imirNo}<span className="mx-2 text-slate-300">|</span>DN date: {formatDate(dn.dnDate)}</>}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
      footer={(
        <>
          <Button icon={ExternalLink} onClick={() => navigate(`/dns/${id}`)}>{dn.allowedActions?.length ? 'Work on DN' : 'Open DN'}</Button>
          <a href={`/api/v1/dns/${id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"><Printer className="w-4 h-4" />Print</a>
          <a href={`/api/v1/dns/${id}/xlsx`} download className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="w-4 h-4 text-emerald-700" />Excel</a>
        </>
      )}
    >
      {tab === 'details' && (
        <>
          <DrawerCard icon={Info} title="Lot" rows={[
            ['IMIR No.', dn.imirNo],
            ['GRN No.', `${dn.grnNo} · ${formatDate(dn.grnDate)}`],
            ['Invoice No.', dn.invoiceNo],
            ['Item', `${dn.itemCode} · ${dn.itemDescription ?? ''}`],
            ['Vendor', `${dn.vendorName} (${dn.vendorCode})`],
            ['Received Qty.', dn.receivedQty !== null && dn.receivedQty !== undefined ? formatQty(dn.receivedQty, dn.uom) : null],
            ['Plant', dn.plantName],
          ]} />
          <DrawerCard icon={ClipboardList} title="Defect & CAPA" rows={[
            ['Status', <DnStatus key="s" status={dn.status} overdue={dn.capaOverdue} />],
            ['Waiting with', current && !current.closed ? current.holder ?? current.label : null],
            ['Defect', dn.defect],
            ['Defective Qty.', dn.defectiveQty !== null && dn.defectiveQty !== undefined ? formatQty(dn.defectiveQty, dn.uom) : null],
            ['CAPA due', dn.capaApplicable ? <span key="d" className={dn.capaOverdue ? 'text-rose-700 font-semibold' : ''}>{formatDateTime(dn.capaDueAt)}</span> : 'Not applicable'],
            ['Raised by', dn.createdByName],
            dn.closedAt ? ['Closed', `${formatDateTime(dn.closedAt)}${dn.closedByName ? ` · ${dn.closedByName}` : ''}`] : null,
          ]} />
        </>
      )}
      {tab === 'docs' && (
        <DrawerCard title="Documents & linked records">
          <ul className="px-4 pb-3 divide-y divide-slate-100 text-sm">
            <li className="py-2 flex items-center gap-2"><Printer className="w-4 h-4 text-slate-400" /><a className="text-blue-700 hover:underline" href={`/api/v1/dns/${id}/pdf`} target="_blank" rel="noreferrer">Defect notification (PDF)</a></li>
            <li className="py-2 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /><a className="text-blue-700 hover:underline" href={`/api/v1/dns/${id}/xlsx`} download>Defect notification (Excel)</a></li>
            <li className="py-2 flex items-center gap-2"><PackageOpen className="w-4 h-4 text-slate-400" /><Link className="text-blue-700 hover:underline" to={`/imirs/${dn.imirId}`}>Inspection report {dn.imirNo}</Link></li>
            {dn.deviation && <li className="py-2 flex items-center gap-2"><FileWarning className="w-4 h-4 text-slate-400" /><Link className="text-blue-700 hover:underline" to={`/deviations/${dn.deviation.id}`}>{dn.deviation.deviationNo}</Link></li>}
          </ul>
        </DrawerCard>
      )}
      {tab === 'history' && <PreviewHistory rows={stageRows({ history: dn.history.filter((h) => h.dnId), current })} />}
    </Drawer>
  );
}
