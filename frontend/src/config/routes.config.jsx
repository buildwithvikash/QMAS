import { PERMISSIONS as P } from '@qmas/shared';
import { BarChart3, ClipboardCheck, FileSpreadsheet, FileWarning, FileX2, Home, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { lazy } from 'react';

const HomePage = lazy(() => import('../pages/Home.jsx'));
const UsersPage = lazy(() => import('../pages/admin/UsersPage.jsx'));
const RolesPage = lazy(() => import('../pages/admin/RolesPage.jsx'));
const AuditTrailPage = lazy(() => import('../pages/admin/AuditTrailPage.jsx'));
const MasterListPage = lazy(() => import('../pages/masters/MasterListPage.jsx'));
const SamplingTablePage = lazy(() => import('../pages/masters/SamplingTablePage.jsx'));
const NumberSeriesPage = lazy(() => import('../pages/masters/NumberSeriesPage.jsx'));
const FormatLibraryPage = lazy(() => import('../pages/formats/FormatLibraryPage.jsx'));
const FormatItemPage = lazy(() => import('../pages/formats/FormatItemPage.jsx'));
const FormatVersionPage = lazy(() => import('../pages/formats/FormatVersionPage.jsx'));
const FormatEditorPage = lazy(() => import('../pages/formats/FormatEditorPage.jsx'));
const FormatConflictsPage = lazy(() => import('../pages/formats/FormatConflictsPage.jsx'));
const ApprovalQueuePage = lazy(() => import('../pages/formats/ApprovalQueuePage.jsx'));
const FormatImportPage = lazy(() => import('../pages/formats/FormatImportPage.jsx'));
const ImirListPage = lazy(() => import('../pages/imir/ImirListPage.jsx'));
const ImirPage = lazy(() => import('../pages/imir/ImirPage.jsx'));
const TabletPage = lazy(() => import('../pages/imir/TabletPage.jsx'));
const DeviationListPage = lazy(() => import('../pages/deviation/DeviationListPage.jsx'));
const DeviationPage = lazy(() => import('../pages/deviation/DeviationPage.jsx'));
const DnListPage = lazy(() => import('../pages/dn/DnListPage.jsx'));
const DnPage = lazy(() => import('../pages/dn/DnPage.jsx'));
const ReportsPage = lazy(() => import('../pages/reports/ReportsPage.jsx'));
const ApprovalChainPage = lazy(() => import('../pages/masters/ApprovalChainPage.jsx'));
const DevicesPage = lazy(() => import('../pages/admin/DevicesPage.jsx'));
const SapSyncPage = lazy(() => import('../pages/admin/SapSyncPage.jsx'));
const InsightsPage = lazy(() => import('../pages/ai/InsightsPage.jsx'));
const AskPage = lazy(() => import('../pages/ai/AskPage.jsx'));

/**
 * Sidebar sections and routes, filtered by the user's permissions (same idea as WRL's
 * ROUTE_CONFIG).
 */
export const ROUTE_SECTIONS = [
  {
    key: 'home',
    label: 'Home',
    icon: Home,
    items: [{ path: '/', label: 'Dashboard', permission: P.DASHBOARD_VIEW, element: <HomePage /> }],
  },
  {
    key: 'incoming',
    label: 'Incoming Inspection',
    icon: ClipboardCheck,
    activePrefix: '/imirs',
    items: [
      { path: '/imirs', label: 'Incoming Lots', permission: P.IMIR_VIEW, element: <ImirListPage /> },
      { path: '/tablet', label: 'This Tablet', permission: P.IMIR_INSPECT, element: <TabletPage /> },
      { path: '/imirs/:id', hidden: true, permission: P.IMIR_VIEW, element: <ImirPage /> },
    ],
  },
  {
    key: 'deviation',
    label: 'Deviation',
    icon: FileWarning,
    activePrefix: '/deviations',
    items: [
      { path: '/deviations', label: 'Deviations', permission: P.DEVIATION_VIEW, element: <DeviationListPage /> },
      { path: '/deviations/:id', hidden: true, permission: P.DEVIATION_VIEW, element: <DeviationPage /> },
    ],
  },
  {
    key: 'dn',
    label: 'Defect Notification',
    icon: FileX2,
    activePrefix: '/dns',
    items: [
      { path: '/dns', label: 'DN Register', permission: P.DN_VIEW, element: <DnListPage /> },
      { path: '/dns/:id', hidden: true, permission: P.DN_VIEW, element: <DnPage /> },
    ],
  },
  {
    key: 'reports',
    label: 'Reports & Insights',
    icon: BarChart3,
    items: [
      { path: '/reports', label: 'Registers & KPIs', permission: P.REPORTS_VIEW, element: <ReportsPage /> },
      { path: '/insights', label: 'Quality Insights', permission: P.AI_ASSIST, element: <InsightsPage /> },
      { path: '/ask', label: 'Ask QMAS', permission: P.AI_ASSIST, element: <AskPage /> },
    ],
  },
  {
    key: 'formats',
    label: 'Inspection Formats',
    icon: FileSpreadsheet,
    activePrefix: '/formats',
    items: [
      { path: '/formats', label: 'Format Library', permission: P.FORMATS_VIEW, element: <FormatLibraryPage /> },
      { path: '/formats/queue', label: 'Approval Queue', permission: P.FORMATS_APPROVE, element: <ApprovalQueuePage /> },
      { path: '/formats/import', label: 'Import Formats', permission: P.FORMATS_APPROVE, element: <FormatImportPage /> },
      { path: '/formats/items/:itemId', hidden: true, permission: P.FORMATS_VIEW, element: <FormatItemPage /> },
      { path: '/formats/versions/:id', hidden: true, permission: P.FORMATS_VIEW, element: <FormatVersionPage /> },
      { path: '/formats/versions/:id/edit', hidden: true, permission: P.FORMATS_CREATE, element: <FormatEditorPage /> },
      { path: '/formats/versions/:id/conflicts', hidden: true, permission: P.FORMATS_VIEW, element: <FormatConflictsPage /> },
    ],
  },
  {
    key: 'masters',
    label: 'Master Config',
    icon: SlidersHorizontal,
    subgroups: [
      { key: 'org', label: 'Organisation' },
      { key: 'inspection', label: 'Inspection' },
    ],
    items: [
      { path: '/masters/plants', label: 'Plants', group: 'org', permission: P.MASTERS_VIEW, element: <MasterListPage key="plants" resource="plants" /> },
      { path: '/masters/number-series', label: 'Number Series', group: 'org', permission: P.MASTERS_VIEW, element: <NumberSeriesPage /> },
      { path: '/masters/instruments', label: 'Instruments', group: 'inspection', permission: P.MASTERS_VIEW, element: <MasterListPage key="instruments" resource="instruments" /> },
      { path: '/masters/sampling', label: 'Sampling Table', group: 'inspection', permission: P.MASTERS_VIEW, element: <SamplingTablePage /> },
      { path: '/masters/approval-chain', label: 'Deviation Approval', group: 'inspection', permission: P.MASTERS_VIEW, element: <ApprovalChainPage /> },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    items: [
      { path: '/admin/users', label: 'Users', permission: P.USERS_VIEW, element: <UsersPage /> },
      { path: '/admin/roles', label: 'Roles & Permissions', permission: P.USERS_VIEW, element: <RolesPage /> },
      { path: '/admin/devices', label: 'Tablets', permission: P.DEVICES_MANAGE, element: <DevicesPage /> },
      { path: '/admin/sap-sync', label: 'SAP Sync', permission: P.INTEGRATION_MONITOR, element: <SapSyncPage /> },
      { path: '/admin/audit', label: 'Audit Trail', permission: P.AUDIT_VIEW, element: <AuditTrailPage /> },
    ],
  },
];
