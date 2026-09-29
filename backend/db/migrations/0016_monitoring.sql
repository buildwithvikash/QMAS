-- 0016 Application monitoring.
--   error_log: server errors (500s, crashes), worker job failures and crashes in users' browsers,
--     grouped by a fingerprint (where + what) so a repeating error is one row with a count. An
--     error that comes back after being resolved reopens its row.
--   service_heartbeat: each API / worker process writes a beat every 30 s, so System Health can
--     say whether the worker is running.
--   monitor_alert: when each kind of alert was last sent (at most one per kind per hour).
CREATE TABLE core.error_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint  text NOT NULL UNIQUE,
  source       text NOT NULL CHECK (source IN ('SERVER', 'WORKER', 'CLIENT')),
  message      text NOT NULL,
  detail       text,                 -- stack trace (server) / component stack (browser)
  method       text,
  path         text,                 -- API route or page
  status_code  integer,
  request_id   text,                 -- the reference number shown to the user (latest occurrence)
  user_id      uuid REFERENCES core.app_user (id) ON DELETE SET NULL,
  user_agent   text,
  app_version  text,
  occurrences  integer NOT NULL DEFAULT 1,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES core.app_user (id) ON DELETE SET NULL,
  resolution   text
);
CREATE INDEX error_log_open_idx ON core.error_log (last_seen DESC) WHERE resolved_at IS NULL;
CREATE INDEX error_log_last_seen_idx ON core.error_log (last_seen DESC);

-- Each occurrence (kept 30 days by the worker), for "errors in the last hour" and spike alerts.
CREATE TABLE core.error_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  error_id    bigint NOT NULL REFERENCES core.error_log (id) ON DELETE CASCADE,
  request_id  text,
  user_id     uuid REFERENCES core.app_user (id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX error_event_at_idx ON core.error_event (at DESC);
CREATE INDEX error_event_error_idx ON core.error_event (error_id, at DESC);

CREATE TABLE core.service_heartbeat (
  component   text PRIMARY KEY,      -- 'api:<host>:<pid>' / 'worker:<host>:<pid>'
  kind        text NOT NULL CHECK (kind IN ('API', 'WORKER')),
  host        text NOT NULL,
  pid         integer NOT NULL,
  version     text,
  started_at  timestamptz NOT NULL,
  last_beat   timestamptz NOT NULL DEFAULT now(),
  info        jsonb
);

CREATE TABLE core.monitor_alert (
  kind          text PRIMARY KEY,
  last_sent_at  timestamptz NOT NULL
);
