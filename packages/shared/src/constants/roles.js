/**
 * Business roles from the IMI & DN blueprint (slide 2) plus System Admin and Auditor.
 *
 * viewScope   OWN_PLANT  – sees only records of plants in the user's role assignments
 *             ALL_PLANTS – sees every plant's incoming list and reports
 * actionScope PLANT      – may act only on records of the assigned plant(s) ("*" roles on slide 2)
 *             ALL        – may act on any plant
 * requiresPlant – a role assignment must name a plant.
 */
export const ROLES = Object.freeze({
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  IQC_INSPECTOR: 'IQC_INSPECTOR',
  IQC_INCHARGE: 'IQC_INCHARGE',
  IQC_HEAD: 'IQC_HEAD',
  SCM_REQUESTOR: 'SCM_REQUESTOR',
  SCM_SUB_HEAD: 'SCM_SUB_HEAD',
  SCM_HEAD: 'SCM_HEAD',
  VD_REQUESTOR: 'VD_REQUESTOR',
  VD_SUB_HEAD: 'VD_SUB_HEAD',
  VD_HEAD: 'VD_HEAD',
  PLANT_HEAD: 'PLANT_HEAD',
  PLANT_QA_HEAD: 'PLANT_QA_HEAD',
  PDC_HEAD: 'PDC_HEAD',
  CQA_HEAD: 'CQA_HEAD',
  CENTRAL_OPS_HEAD: 'CENTRAL_OPS_HEAD',
  PLANT_OPS_HEAD: 'PLANT_OPS_HEAD',
  AUDITOR: 'AUDITOR',
});

export const ROLE_DEFINITIONS = Object.freeze([
  { code: ROLES.SYSTEM_ADMIN, name: 'System Admin', department: 'IT', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, description: 'Full access: users, roles, masters and every record' },
  { code: ROLES.IQC_INSPECTOR, name: 'IQC Inspector', department: 'IQC', viewScope: 'OWN_PLANT', actionScope: 'PLANT', requiresPlant: true, description: 'Inspects incoming lots and records observations' },
  { code: ROLES.IQC_INCHARGE, name: 'IQC Incharge', department: 'IQC', viewScope: 'ALL_PLANTS', actionScope: 'PLANT', requiresPlant: true, description: 'Reviews inspections: approves, sends back or escalates' },
  { code: ROLES.IQC_HEAD, name: 'Plant IQC Head', department: 'IQC', viewScope: 'ALL_PLANTS', actionScope: 'PLANT', requiresPlant: true, description: 'Plant-level IQC decisions, holds and deviations' },
  { code: ROLES.SCM_REQUESTOR, name: 'SCM Requestor', department: 'SCM', viewScope: 'OWN_PLANT', actionScope: 'PLANT', requiresPlant: true, description: 'Fills the deviation form for SCM' },
  { code: ROLES.SCM_SUB_HEAD, name: 'SCM Sub-Head', department: 'SCM', viewScope: 'ALL_PLANTS', actionScope: 'PLANT', requiresPlant: true, description: 'First SCM approval of deviations' },
  { code: ROLES.SCM_HEAD, name: 'SCM Head', department: 'SCM', viewScope: 'ALL_PLANTS', actionScope: 'PLANT', requiresPlant: true, description: 'Final SCM approval of deviations' },
  { code: ROLES.VD_REQUESTOR, name: 'VD Requestor', department: 'VD', viewScope: 'OWN_PLANT', actionScope: 'ALL', requiresPlant: true, description: 'Fills the deviation form for Vendor Development' },
  { code: ROLES.VD_SUB_HEAD, name: 'VD Sub-Head', department: 'VD', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, description: 'First VD approval of deviations' },
  { code: ROLES.VD_HEAD, name: 'VD Head', department: 'VD', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, description: 'Final VD approval of deviations' },
  { code: ROLES.PLANT_HEAD, name: 'Plant Head', department: 'Plant', viewScope: 'ALL_PLANTS', actionScope: 'PLANT', requiresPlant: true, description: 'Senior escalation at the plant (rank 1)' },
  { code: ROLES.PLANT_QA_HEAD, name: 'Plant QA Head', department: 'Quality', viewScope: 'ALL_PLANTS', actionScope: 'PLANT', requiresPlant: true, description: 'Plant quality assurance, senior escalation (rank 2)' },
  { code: ROLES.PDC_HEAD, name: 'PDC Head', department: 'PDC', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, description: 'Product development, senior escalation (rank 3)' },
  { code: ROLES.CQA_HEAD, name: 'CQA Head', department: 'Centralized Quality', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, description: 'Centralized quality, senior escalation (rank 4)' },
  { code: ROLES.CENTRAL_OPS_HEAD, name: 'Central Operations Head', department: 'Operations', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, description: 'Central operations, final senior authority' },
  { code: ROLES.PLANT_OPS_HEAD, name: 'Plant Operations Head', department: 'Operations', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, description: 'Plant operations oversight' },
  { code: ROLES.AUDITOR, name: 'Auditor (read-only)', department: 'Management', viewScope: 'ALL_PLANTS', actionScope: 'ALL', requiresPlant: false, description: 'Read-only access to records and reports' },
]);

/** Senior escalation hierarchy (slide 11). Higher rank = higher authority. */
export const ESCALATION_RANKS = Object.freeze([
  { roleCode: ROLES.PLANT_HEAD, rank: 1 },
  { roleCode: ROLES.PLANT_QA_HEAD, rank: 2 },
  { roleCode: ROLES.PDC_HEAD, rank: 3 },
  { roleCode: ROLES.CQA_HEAD, rank: 4 },
  { roleCode: ROLES.CENTRAL_OPS_HEAD, rank: 5 },
]);
