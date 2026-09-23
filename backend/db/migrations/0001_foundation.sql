-- 0001 Foundation: extensions, schemas, row-meta trigger, audit trail.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive employee codes / emails
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fast ILIKE search on item codes, descriptions, names
CREATE EXTENSION IF NOT EXISTS btree_gist; -- exclusion constraints (non-overlapping sampling ranges)

CREATE SCHEMA IF NOT EXISTS core;   -- users, roles, plants, numbering
CREATE SCHEMA IF NOT EXISTS mst;    -- master data
CREATE SCHEMA IF NOT EXISTS qms;    -- formats, IMIR, deviation, DN (later sprints)
CREATE SCHEMA IF NOT EXISTS intg;   -- SAP / Windchill / SAN-SIR staging (later sprints)
CREATE SCHEMA IF NOT EXISTS sync;   -- tablet offline sync (later sprints)
CREATE SCHEMA IF NOT EXISTS audit;  -- audit trail

-- ── Row meta ─────────────────────────────────────────────────────────────────
-- Every editable table carries updated_at and row_version (optimistic locking).
-- The application updates with "WHERE row_version = $expected"; this trigger bumps it.
CREATE OR REPLACE FUNCTION core.touch_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_by := COALESCE(NULLIF(current_setting('app.user_id', true), '')::uuid, NEW.updated_by);
  RETURN NEW;
END $$;

-- ── Audit trail ──────────────────────────────────────────────────────────────
-- Row-level change log for every business table, partitioned by month.
-- The acting user and request id come from transaction-local settings set by the API
-- (SET LOCAL app.user_id / app.request_id), so direct SQL changes are logged too (actor NULL).
CREATE TABLE audit.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  changed_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  table_name  text        NOT NULL,
  operation   char(1)     NOT NULL CHECK (operation IN ('I', 'U', 'D')),
  row_pk      text,
  actor_id    uuid,
  request_id  text,
  old_data    jsonb,
  new_data    jsonb,
  PRIMARY KEY (id, changed_at)
) PARTITION BY RANGE (changed_at);

CREATE TABLE audit.audit_log_default PARTITION OF audit.audit_log DEFAULT;
CREATE INDEX audit_log_row_idx ON audit.audit_log (table_name, row_pk, changed_at DESC);
CREATE INDEX audit_log_actor_idx ON audit.audit_log (actor_id, changed_at DESC);
CREATE INDEX audit_log_changed_brin ON audit.audit_log USING brin (changed_at);

-- Creates the partition for the month containing p_day (idempotent). Run ahead of time by the
-- worker; the DEFAULT partition only catches rows if that job is late.
CREATE OR REPLACE FUNCTION audit.ensure_month_partition(p_day date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_start date := date_trunc('month', p_day)::date;
  v_end   date := (date_trunc('month', p_day) + interval '1 month')::date;
  v_name  text := format('audit_log_y%sm%s', to_char(v_start, 'YYYY'), to_char(v_start, 'MM'));
BEGIN
  IF to_regclass('audit.' || v_name) IS NULL THEN
    EXECUTE format('CREATE TABLE audit.%I PARTITION OF audit.audit_log FOR VALUES FROM (%L) TO (%L)', v_name, v_start, v_end);
  END IF;
END $$;

DO $$
BEGIN
  FOR i IN 0..12 LOOP
    PERFORM audit.ensure_month_partition((date_trunc('month', now()) + make_interval(months => i))::date);
  END LOOP;
END $$;

-- Columns never written to the audit log (secrets) or ignored when deciding whether an
-- UPDATE changed anything (bookkeeping; updated_by is already recorded as actor_id).
CREATE OR REPLACE FUNCTION audit.strip(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT p - ARRAY['password_hash', 'token_hash', 'updated_at', 'updated_by', 'row_version',
                   'last_login_at', 'failed_login_count', 'locked_until']
$$;

-- AFTER trigger. TG_ARGV = primary-key column names (default: id).
CREATE OR REPLACE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_old  jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN audit.strip(to_jsonb(OLD)) END;
  v_new  jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN audit.strip(to_jsonb(NEW)) END;
  v_row  jsonb := COALESCE(v_new, v_old);
  v_pk   text;
  v_cols text[] := CASE WHEN TG_NARGS > 0 THEN TG_ARGV ELSE ARRAY['id'] END;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(n.key, n.value) INTO v_new
      FROM jsonb_each(audit.strip(to_jsonb(NEW))) n
     WHERE n.value IS DISTINCT FROM v_old -> n.key;
    IF v_new IS NULL THEN
      RETURN NULL;  -- only bookkeeping columns changed
    END IF;
    SELECT jsonb_object_agg(o.key, o.value) INTO v_old
      FROM jsonb_each(v_old) o
     WHERE v_new ? o.key;
  END IF;

  SELECT string_agg(v_row ->> c, ':') INTO v_pk FROM unnest(v_cols) AS c;

  INSERT INTO audit.audit_log (table_name, operation, row_pk, actor_id, request_id, old_data, new_data)
  VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, left(TG_OP, 1), v_pk,
          NULLIF(current_setting('app.user_id', true), '')::uuid,
          NULLIF(current_setting('app.request_id', true), ''),
          v_old, v_new);
  RETURN NULL;
END $$;

-- Helper used by later migrations: attaches the audit trigger and (optionally) the row-meta trigger.
CREATE OR REPLACE FUNCTION audit.track(p_table regclass, p_pk_cols text[] DEFAULT ARRAY['id'], p_touch boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_args text := (SELECT string_agg(quote_literal(c), ', ') FROM unnest(p_pk_cols) c);
BEGIN
  EXECUTE format('CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit.log_change(%s)', p_table, v_args);
  IF p_touch THEN
    EXECUTE format('CREATE TRIGGER touch_row BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION core.touch_row()', p_table);
  END IF;
END $$;

-- Security events (sign-in, lockout, password changes). Kept apart from row changes.
CREATE TABLE audit.auth_event (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  event         text NOT NULL CHECK (event IN ('LOGIN_OK', 'LOGIN_FAILED', 'LOCKED', 'LOGOUT', 'REFRESH_REUSE',
                                               'PASSWORD_CHANGED', 'PASSWORD_RESET', 'UNLOCKED')),
  user_id       uuid,
  employee_code text,
  ip            inet,
  user_agent    text,
  detail        jsonb
);
CREATE INDEX auth_event_user_idx ON audit.auth_event (user_id, at DESC);
CREATE INDEX auth_event_at_brin ON audit.auth_event USING brin (at);
