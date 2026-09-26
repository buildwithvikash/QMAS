-- 0011 User management: one row per sign-in (session) with where it came from and when it was last
-- used, so administrators can see who is online and end a session or all of a user's sessions;
-- an administrator's lock on an account (separate from the automatic lock after failed
-- attempts); and one-time password reset links sent by e-mail ("Forgot password").

-- A session is one sign-in on one device. Its id is the refresh-token family id, so every
-- rotated refresh token of that sign-in belongs to it; the access token carries it as `sid`.
CREATE TABLE core.user_session (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES core.app_user (id) ON DELETE CASCADE,
  client       text NOT NULL DEFAULT 'web' CHECK (client IN ('web', 'tablet')),
  ip           inet,
  host_name    text,
  user_agent   text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  end_reason   text CHECK (end_reason IN ('LOGOUT', 'EXPIRED', 'FORCED', 'FORCED_ALL', 'LOCKED', 'DEACTIVATED', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'REUSE_DETECTED')),
  ended_by     uuid REFERENCES core.app_user (id)
);
CREATE INDEX user_session_open_idx ON core.user_session (user_id) WHERE ended_at IS NULL;
CREATE INDEX user_session_started_idx ON core.user_session (started_at DESC);

-- Sign-ins that are still open become sessions, so they show up and can be ended.
INSERT INTO core.user_session (id, user_id, ip, user_agent, started_at, last_seen_at)
SELECT family_id, user_id,
       (array_agg(ip ORDER BY created_at DESC))[1], (array_agg(user_agent ORDER BY created_at DESC))[1],
       min(created_at), max(created_at)
  FROM core.refresh_token
 GROUP BY family_id, user_id
HAVING bool_or(revoked_at IS NULL AND expires_at > now());

-- Administrator's lock: stays until an administrator unlocks it (the automatic lock after failed
-- attempts, locked_until, ends by itself).
ALTER TABLE core.app_user
  ADD COLUMN is_locked     boolean NOT NULL DEFAULT false,
  ADD COLUMN locked_reason text,
  ADD COLUMN locked_at     timestamptz,
  ADD COLUMN locked_by     uuid REFERENCES core.app_user (id);

-- Reset links: only a hash of the token is kept; a link works once and for a short time.
CREATE TABLE core.password_reset (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES core.app_user (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  requested_by uuid REFERENCES core.app_user (id),   -- set when an administrator sent it
  requested_ip inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX password_reset_user_idx ON core.password_reset (user_id, created_at DESC);

-- New sign-in log events.
ALTER TABLE audit.auth_event DROP CONSTRAINT auth_event_event_check;
ALTER TABLE audit.auth_event ADD CONSTRAINT auth_event_event_check CHECK (event IN (
  'LOGIN_OK', 'LOGIN_FAILED', 'LOCKED', 'LOGOUT', 'REFRESH_REUSE', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'UNLOCKED',
  'ADMIN_LOCKED', 'FORCE_LOGOUT', 'FORCE_LOGOUT_ALL', 'RESET_LINK_SENT', 'RESET_LINK_REQUESTED', 'PASSWORD_RESET_BY_LINK'));
