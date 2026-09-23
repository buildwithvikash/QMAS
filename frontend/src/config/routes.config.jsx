import { PERMISSIONS as P } from '@qmas/shared';
import { FileSpreadsheet, Home, ShieldCheck, SlidersHorizontal } from 'lucide-react';
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

/**
 * Sidebar sections and routes, filtered by the user's permissions (same idea as WRL's
 * ROUTE_CONFIG). Later modules — formats, incoming inspection, deviation, DN — are added here.
 */
export const ROUTE_SECTIONS = [
  {
    key: 'home',
    label: 'Home',
    icon: Home,
    items: [{ path: '/', label: 'Dashboard', permission: P.DASHBOARD_VIEW, element: <HomePage /> }],
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
      { key: 'material', label: 'Material' },
      { key: 'inspection', label: 'Inspection' },
    ],
    items: [
      { path: '/masters/plants', label: 'Plants', group: 'org', permission: P.MASTERS_VIEW, element: <MasterListPage key="plants" resource="plants" /> },
      { path: '/masters/number-series', label: 'Number Series', group: 'org', permission: P.MASTERS_VIEW, element: <NumberSeriesPage /> },
      { path: '/masters/vendors', label: 'Vendors', group: 'material', permission: P.MASTERS_VIEW, element: <MasterListPage key="vendors" resource="vendors" /> },
      { path: '/masters/items', label: 'Items', group: 'material', permission: P.MASTERS_VIEW, element: <MasterListPage key="items" resource="items" /> },
      { path: '/masters/item-categories', label: 'Item Categories', group: 'material', permission: P.MASTERS_VIEW, element: <MasterListPage key="item-categories" resource="item-categories" /> },
      { path: '/masters/uoms', label: 'Units of Measure', group: 'material', permission: P.MASTERS_VIEW, element: <MasterListPage key="uoms" resource="uoms" /> },
      { path: '/masters/instruments', label: 'Instruments', group: 'inspection', permission: P.MASTERS_VIEW, element: <MasterListPage key="instruments" resource="instruments" /> },
      { path: '/masters/sampling', label: 'Sampling Table', group: 'inspection', permission: P.MASTERS_VIEW, element: <SamplingTablePage /> },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    items: [
      { path: '/admin/users', label: 'Users', permission: P.USERS_VIEW, element: <UsersPage /> },
      { path: '/admin/roles', label: 'Roles & Permissions', permission: P.USERS_VIEW, element: <RolesPage /> },
      { path: '/admin/audit', label: 'Audit Trail', permission: P.AUDIT_VIEW, element: <AuditTrailPage /> },
    ],
  },
];
