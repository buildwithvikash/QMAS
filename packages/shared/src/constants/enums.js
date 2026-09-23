/** Documents numbered per plant through the Number Series master. */
export const DOC_TYPES = Object.freeze(['IMIR', 'DN', 'DEVIATION']);

export const RESET_SCOPES = Object.freeze(['DAY', 'MONTH', 'YEAR', 'NEVER']);

/** DN "feedback from" source codes used by the {SRC} numbering token. */
export const DN_SOURCES = Object.freeze({ IL: 'Incoming Lot', LN: 'Line', RL: 'Reliability / Lab', FD: 'Field' });

export const DEVIATION_ACTIONS = Object.freeze([
  { code: 'UAI', name: 'Use As Is' },
  { code: 'SEGREGATION', name: 'Segregation' },
  { code: 'REWORK', name: 'Rework' },
]);

export const DEVIATION_SEVERITIES = Object.freeze([
  { code: 'MINOR', name: 'Minor' },
  { code: 'MAJOR', name: 'Major' },
  { code: 'CRITICAL', name: 'Critical' },
]);

/** Business time zone: document numbers and "today" are evaluated in IST. */
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
