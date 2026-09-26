/** "Chrome · Windows" from a browser's user-agent string (enough to recognise a device). */
export function deviceOf(ua) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|axios|supertest/i.test(ua) ? 'Script' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export const lockedByAdmin = (u) => !!u.isLocked;
export const lockedAfterFailures = (u) => !u.isLocked && !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
export const isLocked = (u) => lockedByAdmin(u) || lockedAfterFailures(u);

/** Why a session ended, in words. */
export const END_REASON = {
  LOGOUT: 'Signed out',
  EXPIRED: 'Expired',
  FORCED: 'Signed out by administrator',
  FORCED_ALL: 'Everyone signed out',
  LOCKED: 'Account locked',
  DEACTIVATED: 'Account deactivated',
  PASSWORD_RESET: 'Password reset',
  PASSWORD_CHANGED: 'Password changed',
  REUSE_DETECTED: 'Stopped: token reuse',
  REPLACED: 'Signed in on another device',
  IDLE: 'Signed out after inactivity',
};

/** Sign-in log events: label and badge colour. */
export const EVENTS = {
  LOGIN_OK: ['Signed in', 'success'],
  LOGIN_FAILED: ['Sign-in failed', 'warning'],
  LOCKED: ['Locked (failed attempts)', 'danger'],
  LOGOUT: ['Signed out', 'neutral'],
  REFRESH_REUSE: ['Token reuse stopped', 'danger'],
  PASSWORD_CHANGED: ['Password changed', 'info'],
  PASSWORD_RESET: ['Password reset by admin', 'info'],
  UNLOCKED: ['Unlocked', 'success'],
  ADMIN_LOCKED: ['Locked by admin', 'danger'],
  FORCE_LOGOUT: ['Signed out by admin', 'warning'],
  FORCE_LOGOUT_ALL: ['Everyone signed out', 'warning'],
  RESET_LINK_SENT: ['Reset link sent by admin', 'info'],
  RESET_LINK_REQUESTED: ['Reset link requested', 'info'],
  PASSWORD_RESET_BY_LINK: ['Password reset by link', 'info'],
};

/** Readable detail of a sign-in failure. */
export const FAIL_REASON = { UNKNOWN_USER: 'unknown employee code', BAD_PASSWORD: 'wrong password', LOCKED: 'account locked', INACTIVE: 'account deactivated', ADMIN_LOCKED: 'locked by admin' };
