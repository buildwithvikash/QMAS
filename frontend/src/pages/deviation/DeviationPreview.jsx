import { ClipboardList, ExternalLink, FileSpreadsheet, Info, PackageOpen, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetDeviationQuery } from '../../api/workflowApi.js';
import Button from '../../components/ui/Button.jsx';
import Drawer, { DrawerCard } from '../../components/ui/Drawer.jsx';
import { formatDate, formatDateTime, formatQty } from '../../utils/format.js';
import { currentStage, journeySteps, stageRows } from '../imir/journey.js';
import { PreviewHistory } from '../imir/ImirPreview.jsx';
import { ACTION_NAMES } from './workflowLabels.js';
import { DeviationStage } from './workflowUi.jsx';

const TABS = [{ key: 'details', label: 'Details' }, { key: 'docs', label: 'Documents' }, { key: 'history', label: 'History' }];

/** Quick look at a deviation from the list: the lot, the request and its stage history. */
export default function DeviationPreview({ id, onClose }) {
  const { data: d, isLoading } = useGetDeviationQuery(id);
  const [tab, setTab] = useState('details');
  const navigate = useNavigate();

  if (isLoading || !d) {
    return <Drawer title="Loading…" onClose={onClose}><div className="space-y-3">{[1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div></Drawer>;
  }
  const current = currentStage(journeySteps({ status: d.imirStatus, history: d.history, deviation: d }));
  const acting = d.allowedActions?.length > 0;

  return (
    <Drawer
      title={d.deviationNo}
      badge={<DeviationStage stage={d.stage} outcome={d.outcome} />}
      subtitle={<>IMIR: {d.imirNo}<span className="mx-2 text-slate-300">|</span>{d.department}</>}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
      footer={(
        <>
          <Button icon={ExternalLink} onClick={() => navigate(`/deviations/${id}`)}>{acting ? 'Review deviation' : 'Open deviation'}</Button>
          <a href={`/api/v1/deviations/${id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"><Printer className="w-4 h-4" />Print</a>
          <a href={`/api/v1/deviations/${id}/xlsx`} download className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="w-4 h-4 text-emerald-700" />Excel</a>
        </>
      )}
    >
      {tab === 'details' && (
        <>
          <DrawerCard icon={Info} title="Lot" rows={[
            ['IMIR No.', d.imirNo],
            ['GRN No.', `${d.grnNo} · ${formatDate(d.grnDate)}`],
            ['Item', `${d.itemCode} · ${d.itemDescription ?? ''}`],
            ['Vendor', `${d.vendorName} (${d.vendorCode})`],
            ['Inward Qty.', formatQty(d.inwardQty, d.uom)],
            ['Plant', d.plantName],
          ]} />
          <DrawerCard icon={ClipboardList} title="Deviation" rows={[
            ['Stage', <DeviationStage key="s" stage={d.stage} outcome={d.outcome} />],
            ['Waiting with', current && !current.closed ? current.holder ?? current.label : null],
            ['Department', d.department],
            ['Initiator', d.initiatorName],
            ['Action', d.action ? ACTION_NAMES[d.action] : d.suggestedActions?.length ? `Suggested: ${d.suggestedActions.map((a) => ACTION_NAMES[a]).join(' / ')}` : null],
            ['Deviation Qty.', d.deviationQty !== null && d.deviationQty !== undefined ? formatQty(d.deviationQty, d.uom) : null],
            ['IQC observation', d.iqcObservation],
            ['Hold remark', d.holdRemark],
            d.qtyDueAt ? ['Quantities due', formatDateTime(d.qtyDueAt)] : null,
          ]} />
        </>
      )}
      {tab === 'docs' && (
        <DrawerCard title="Documents & linked records">
          <ul className="px-4 pb-3 divide-y divide-slate-100 text-sm">
            <li className="py-2 flex items-center gap-2"><Printer className="w-4 h-4 text-slate-400" /><a className="text-blue-700 hover:underline" href={`/api/v1/deviations/${id}/pdf`} target="_blank" rel="noreferrer">Deviation form (PDF)</a></li>
            <li className="py-2 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /><a className="text-blue-700 hover:underline" href={`/api/v1/deviations/${id}/xlsx`} download>Deviation form (Excel)</a></li>
            <li className="py-2 flex items-center gap-2"><PackageOpen className="w-4 h-4 text-slate-400" /><Link className="text-blue-700 hover:underline" to={`/imirs/${d.imirId}`}>Inspection report {d.imirNo}</Link></li>
          </ul>
        </DrawerCard>
      )}
      {tab === 'history' && <PreviewHistory rows={stageRows({ history: d.history, current })} />}
    </Drawer>
  );
}
