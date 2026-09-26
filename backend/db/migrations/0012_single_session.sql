-- 0012 One sign-in per user, and sign-out after inactivity.
--   REPLACED: a new sign-in ended the user's other sessions.
--   IDLE: no user activity (typing, clicking, scrolling) for IDLE_TIMEOUT_MIN minutes.
-- last_active_at moves only with real activity reported by the browser; last_seen_at also moves
-- with background refreshes, so a forgotten open tab still shows as seen but becomes idle.
ALTER TABLE core.user_session ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now();
UPDATE core.user_session SET last_active_at = last_seen_at;

ALTER TABLE core.user_session DROP CONSTRAINT user_session_end_reason_check;
ALTER TABLE core.user_session ADD CONSTRAINT user_session_end_reason_check CHECK (end_reason IN (
  'LOGOUT', 'EXPIRED', 'FORCED', 'FORCED_ALL', 'LOCKED', 'DEACTIVATED', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'REUSE_DETECTED',
  'REPLACED', 'IDLE'));
