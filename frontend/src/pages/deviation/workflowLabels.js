/** Display names for the review / deviation workflow. */
export const STAGES = {
  INITIATOR: ['With initiator', 'info'],
  SUB_HEAD: ['With Sub-Head', 'neutral'],
  HEAD: ['With Head', 'neutral'],
  FINAL: ['IQC Head decision', 'primary'],
  SENIOR: ['Senior escalation', 'danger'],
  UNDER_DEVIATION: ['Awaiting quantities', 'warning'],
  QTY_VERIFICATION: ['Quantity check', 'warning'],
  CLOSED: ['Closed', 'neutral'],
};

export const ACTION_NAMES = { UAI: 'Use As Is', SEGREGATION: 'Segregation', REWORK: 'Rework' };

export const DECISION_NAMES = { APPROVE: 'Approve', REJECT: 'Reject', CHANGE_TYPE: 'Change type' };

export const ROLE_SHORT = {
  PLANT_HEAD: 'Plant Head', PLANT_QA_HEAD: 'Plant QA Head', PDC_HEAD: 'PDC Head', CQA_HEAD: 'CQA Head', CENTRAL_OPS_HEAD: 'Central Operations Head',
};
