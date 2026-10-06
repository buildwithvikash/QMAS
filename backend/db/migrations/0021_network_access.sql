-- 0021 Network access control: QMAS works only from the company network, unless an admin has
-- granted a user external access for a set period (with a reason). Every grant and revocation is
-- kept: a grant's who / when / period / reason never change; it can only be revoked once.

-- The company network: address ranges (CIDR). One row. Defaults to the private (LAN) ranges.
CREATE TABLE core.network_setting (
  id                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforce           boolean NOT NULL DEFAULT true,
  internal_networks text[] NOT NULL DEFAULT ARRAY['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '::1/128', 'fc00::/7', 'fe80::/10'],
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES core.app_user (id),
  row_version       integer NOT NULL DEFAULT 1
);
INSERT INTO core.network_setting (id) VALUES (1);
SELECT audit.track('core.network_setting');

CREATE TABLE core.external_access_grant (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES core.app_user (id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reason        text NOT NULL CHECK (length(btrim(reason)) > 0),
  granted_by    uuid NOT NULL REFERENCES core.app_user (id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES core.app_user (id),
  revoke_reason text,
  CHECK (ends_at > starts_at),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX external_access_user_idx ON core.external_access_grant (user_id, ends_at DESC) WHERE revoked_at IS NULL;
SELECT audit.track('core.external_access_grant', ARRAY['id'], false);

-- Audit trail: the grant itself never changes and is never deleted; revocation happens once.
CREATE OR REPLACE FUNCTION core.external_access_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'External-access grants cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     OR NEW.user_id <> OLD.user_id OR NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.reason <> OLD.reason
     OR NEW.granted_by <> OLD.granted_by OR NEW.granted_at <> OLD.granted_at THEN
    RAISE EXCEPTION 'An external-access grant cannot be changed, only revoked once' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER external_access_guard BEFORE UPDATE OR DELETE ON core.external_access_grant
  FOR EACH ROW EXECUTE FUNCTION core.external_access_guard();

INSERT INTO core.permission (key, module, description) VALUES
  ('network.manage', 'Administration', 'Set the company network and grant or revoke external access')
ON CONFLICT (key) DO NOTHING;
INSERT INTO core.role_permission (role_code, permission_key)
SELECT code, 'network.manage' FROM core.role WHERE code = 'SYSTEM_ADMIN'
ON CONFLICT DO NOTHING;
