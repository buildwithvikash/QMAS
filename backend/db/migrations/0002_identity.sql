-- 0002 Users, roles, permissions, plants, sessions.

CREATE TABLE core.app_user (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code        citext   NOT NULL UNIQUE CHECK (length(employee_code) BETWEEN 1 AND 30),
  full_name            text     NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  email                citext   UNIQUE,
  phone                text,
  password_hash        text     NOT NULL,
  must_change_password boolean  NOT NULL DEFAULT true,
  is_active            boolean  NOT NULL DEFAULT true,
  failed_login_count   smallint NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until         timestamptz,
  last_login_at        timestamptz,
  password_changed_at  timestamptz,
  token_version        integer  NOT NULL DEFAULT 0,  -- bump to invalidate every issued access token
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES core.app_user (id),
  updated_by           uuid REFERENCES core.app_user (id),
  row_version          integer NOT NULL DEFAULT 1
);
CREATE INDEX app_user_name_trgm ON core.app_user USING gin (full_name gin_trgm_ops);
SELECT audit.track('core.app_user');

CREATE TABLE core.plant (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sap_code    text NOT NULL UNIQUE CHECK (sap_code ~ '^\d{4}$'),
  short_code  text NOT NULL UNIQUE CHECK (short_code ~ '^\d{2}$'),
  name        text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.app_user (id),
  updated_by  uuid REFERENCES core.app_user (id),
  row_version integer NOT NULL DEFAULT 1
);
SELECT audit.track('core.plant');

CREATE TABLE core.role (
  code           text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]*$'),
  name           text NOT NULL UNIQUE,
  department     text NOT NULL,
  view_scope     text NOT NULL CHECK (view_scope IN ('OWN_PLANT', 'ALL_PLANTS')),
  action_scope   text NOT NULL CHECK (action_scope IN ('PLANT', 'ALL')),
  requires_plant boolean NOT NULL,
  sort_order     smallint NOT NULL DEFAULT 0
);

CREATE TABLE core.permission (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z_]+\.[a-z_]+$'),
  module      text NOT NULL,
  description text NOT NULL,
  sort_order  smallint NOT NULL DEFAULT 0
);

CREATE TABLE core.role_permission (
  role_code      text NOT NULL REFERENCES core.role (code) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES core.permission (key) ON DELETE CASCADE,
  granted_by     uuid REFERENCES core.app_user (id),
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, permission_key)
);
SELECT audit.track('core.role_permission', ARRAY['role_code', 'permission_key'], false);

-- A user may hold several roles, each optionally bound to a plant (NULL = all plants).
-- valid_to supports temporary assignments such as leave delegation.
CREATE TABLE core.user_role (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid     NOT NULL REFERENCES core.app_user (id) ON DELETE CASCADE,
  role_code  text     NOT NULL REFERENCES core.role (code),
  plant_id   smallint REFERENCES core.plant (id),
  valid_from date     NOT NULL DEFAULT current_date,
  valid_to   date     CHECK (valid_to IS NULL OR valid_to >= valid_from),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES core.app_user (id)
);
CREATE UNIQUE INDEX user_role_unique ON core.user_role (user_id, role_code, COALESCE(plant_id, 0));
CREATE INDEX user_role_role_plant_idx ON core.user_role (role_code, plant_id);
SELECT audit.track('core.user_role', ARRAY['id'], false);

-- Refresh tokens: only a SHA-256 hash is stored. Tokens rotate on every use; tokens of one
-- sign-in share a family so that reuse of an old token revokes the whole family.
CREATE TABLE core.refresh_token (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid  NOT NULL REFERENCES core.app_user (id) ON DELETE CASCADE,
  family_id      uuid  NOT NULL,
  token_hash     bytea NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  replaced_by    uuid REFERENCES core.refresh_token (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  user_agent     text,
  ip             inet
);
CREATE INDEX refresh_token_active_idx ON core.refresh_token (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_token_family_idx ON core.refresh_token (family_id);
