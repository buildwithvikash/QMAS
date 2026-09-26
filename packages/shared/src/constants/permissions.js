import { ROLES } from './roles.js';

/**
 * Permission catalogue. The API authorizes on these keys; the web app's menu is built from them.
 * Keys for later modules are defined now so the role matrix is complete from day one.
 */
export const PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: 'dashboard.view',
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  MASTERS_VIEW: 'masters.view',
  MASTERS_MANAGE: 'masters.manage',
  NUMBERING_MANAGE: 'numbering.manage',
  SAMPLING_MANAGE: 'sampling.manage',
  AUDIT_VIEW: 'audit.view',
  FORMATS_VIEW: 'formats.view',
  FORMATS_CREATE: 'formats.create',
  FORMATS_APPROVE: 'formats.approve',
  IMIR_VIEW: 'imir.view',
  IMIR_INSPECT: 'imir.inspect',
  IMIR_REVIEW: 'imir.review',
  IMIR_HEAD_DECIDE: 'imir.head_decide',
  DEVIATION_VIEW: 'deviation.view',
  DEVIATION_INITIATE: 'deviation.initiate',
  DEVIATION_APPROVE: 'deviation.approve',
  DEVIATION_FINAL_DECIDE: 'deviation.final_decide',
  ESCALATION_DECIDE: 'escalation.decide',
  ESCALATION_OVERRIDE: 'escalation.override',
  DN_VIEW: 'dn.view',
  DN_MANAGE: 'dn.manage',
  DN_APPROVE_CAPA: 'dn.approve_capa',
  DEVICES_MANAGE: 'devices.manage',
  INTEGRATION_MONITOR: 'integration.monitor',
  REPORTS_VIEW: 'reports.view',
  AI_ASSIST: 'ai.assist',
});

export const PERMISSION_DEFINITIONS = Object.freeze([
  { key: PERMISSIONS.DASHBOARD_VIEW, module: 'Home', description: 'Dashboard, own task list, notifications and search' },
  { key: PERMISSIONS.USERS_VIEW, module: 'Administration', description: 'View users, their roles, who is signed in and their sessions' },
  { key: PERMISSIONS.USERS_MANAGE, module: 'Administration', description: 'Add and edit users and roles; reset passwords, lock and unlock accounts, sign users out' },
  { key: PERMISSIONS.ROLES_MANAGE, module: 'Administration', description: 'Change the permissions granted to each role' },
  { key: PERMISSIONS.MASTERS_VIEW, module: 'Master Config', description: 'View master configuration: plants, number series, instruments, sampling table, deviation approval' },
  { key: PERMISSIONS.MASTERS_MANAGE, module: 'Master Config', description: 'Edit plants, instruments and deviation approval chains' },
  { key: PERMISSIONS.NUMBERING_MANAGE, module: 'Master Config', description: 'Configure IMIR / DN / Deviation number series' },
  { key: PERMISSIONS.SAMPLING_MANAGE, module: 'Master Config', description: 'Maintain the sampling table' },
  { key: PERMISSIONS.AUDIT_VIEW, module: 'Administration', description: 'View the audit trail and the sign-in log' },
  { key: PERMISSIONS.FORMATS_VIEW, module: 'Inspection Formats', description: 'View inspection formats and versions' },
  { key: PERMISSIONS.FORMATS_CREATE, module: 'Inspection Formats', description: 'Create and edit format drafts' },
  { key: PERMISSIONS.FORMATS_APPROVE, module: 'Inspection Formats', description: 'Approve or reject formats, resolve merge conflicts' },
  { key: PERMISSIONS.IMIR_VIEW, module: 'Incoming Inspection', description: 'View incoming lots and IMIRs' },
  { key: PERMISSIONS.IMIR_INSPECT, module: 'Incoming Inspection', description: 'Record observations and submit IMIRs, also on a tablet' },
  { key: PERMISSIONS.IMIR_REVIEW, module: 'Incoming Inspection', description: 'Incharge review: approve, revert, escalate' },
  { key: PERMISSIONS.IMIR_HEAD_DECIDE, module: 'Incoming Inspection', description: 'IQC Head decision: approve or hold' },
  { key: PERMISSIONS.DEVIATION_VIEW, module: 'Deviation', description: 'View deviations' },
  { key: PERMISSIONS.DEVIATION_INITIATE, module: 'Deviation', description: 'Fill the Deviation Form as SCM/VD initiator' },
  { key: PERMISSIONS.DEVIATION_APPROVE, module: 'Deviation', description: 'Approve deviations as SCM/VD Sub-Head or Head' },
  { key: PERMISSIONS.DEVIATION_FINAL_DECIDE, module: 'Deviation', description: 'IQC Head final decision and escalation' },
  { key: PERMISSIONS.ESCALATION_DECIDE, module: 'Deviation', description: 'Decide as a senior authority' },
  { key: PERMISSIONS.ESCALATION_OVERRIDE, module: 'Deviation', description: 'Override the final decision (Rule 4)' },
  { key: PERMISSIONS.DN_VIEW, module: 'Defect Notification', description: 'View defect notifications' },
  { key: PERMISSIONS.DN_MANAGE, module: 'Defect Notification', description: "Raise DNs and enter the vendor's CAPA" },
  { key: PERMISSIONS.DN_APPROVE_CAPA, module: 'Defect Notification', description: 'Approve or return CAPA' },
  { key: PERMISSIONS.DEVICES_MANAGE, module: 'Administration', description: 'Register tablets and release lot locks' },
  { key: PERMISSIONS.INTEGRATION_MONITOR, module: 'Administration', description: 'View the SAP (QA32) lot sync and pull lots now' },
  { key: PERMISSIONS.REPORTS_VIEW, module: 'Reports', description: 'View and export reports' },
  { key: PERMISSIONS.AI_ASSIST, module: 'AI Assistant', description: 'Quality Insights, AI summaries, CAPA assessment, root-cause suggestions, search in words and Ask QMAS' },
]);

const P = PERMISSIONS;
const VIEW_ALL = [P.DASHBOARD_VIEW, P.MASTERS_VIEW, P.FORMATS_VIEW, P.IMIR_VIEW, P.DEVIATION_VIEW, P.DN_VIEW, P.REPORTS_VIEW];
const SENIOR = [...VIEW_ALL, P.ESCALATION_DECIDE, P.AI_ASSIST];

/** Default grants seeded into core.role_permission. Admins can change them later. */
export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SYSTEM_ADMIN]: Object.values(P),
  [ROLES.IQC_INSPECTOR]: [P.DASHBOARD_VIEW, P.MASTERS_VIEW, P.FORMATS_VIEW, P.IMIR_VIEW, P.IMIR_INSPECT],
  [ROLES.IQC_INCHARGE]: [...VIEW_ALL, P.FORMATS_CREATE, P.IMIR_REVIEW, P.DN_MANAGE, P.DEVICES_MANAGE, P.AI_ASSIST],
  [ROLES.IQC_HEAD]: [...VIEW_ALL, P.FORMATS_CREATE, P.FORMATS_APPROVE, P.IMIR_HEAD_DECIDE, P.DEVIATION_FINAL_DECIDE, P.DN_APPROVE_CAPA, P.SAMPLING_MANAGE, P.AI_ASSIST],
  [ROLES.SCM_REQUESTOR]: [P.DASHBOARD_VIEW, P.IMIR_VIEW, P.DEVIATION_VIEW, P.DEVIATION_INITIATE],
  [ROLES.SCM_SUB_HEAD]: [...VIEW_ALL, P.DEVIATION_APPROVE],
  [ROLES.SCM_HEAD]: [...VIEW_ALL, P.DEVIATION_APPROVE],
  [ROLES.VD_REQUESTOR]: [P.DASHBOARD_VIEW, P.IMIR_VIEW, P.DEVIATION_VIEW, P.DEVIATION_INITIATE],
  [ROLES.VD_SUB_HEAD]: [...VIEW_ALL, P.DEVIATION_APPROVE],
  [ROLES.VD_HEAD]: [...VIEW_ALL, P.DEVIATION_APPROVE],
  [ROLES.PLANT_HEAD]: SENIOR,
  [ROLES.PLANT_QA_HEAD]: SENIOR,
  [ROLES.PDC_HEAD]: SENIOR,
  [ROLES.CQA_HEAD]: [...SENIOR, P.ESCALATION_OVERRIDE],
  [ROLES.CENTRAL_OPS_HEAD]: [...SENIOR, P.ESCALATION_OVERRIDE],
  [ROLES.PLANT_OPS_HEAD]: [...VIEW_ALL, P.AI_ASSIST],
  [ROLES.AUDITOR]: [...VIEW_ALL, P.USERS_VIEW, P.AUDIT_VIEW],
});
