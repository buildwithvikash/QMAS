-- 0013 Roles managed from the Roles & Permissions screen.
--   Built-in roles (is_system) come from the code and drive the workflow; only their description
--   and permissions can change. Custom roles are added by an administrator (new or a copy of a
--   role): they grant permissions only, have no workflow step, and can be deactivated or deleted.
--   An inactive role gives its holders nothing until it is active again.
ALTER TABLE core.role
  ADD COLUMN description text,
  ADD COLUMN is_system   boolean NOT NULL DEFAULT false,
  ADD COLUMN is_active   boolean NOT NULL DEFAULT true,
  ADD COLUMN created_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN created_by  uuid REFERENCES core.app_user (id),
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_by  uuid REFERENCES core.app_user (id),
  ADD CONSTRAINT role_system_active CHECK (is_active OR NOT is_system);

-- Every role that exists now was created by the seed from the code.
UPDATE core.role SET is_system = true;

-- When a role's permissions last changed (for "Last updated" on the screen).
UPDATE core.role r SET updated_at = x.at
  FROM (SELECT role_code, max(granted_at) AS at FROM core.role_permission GROUP BY role_code) x
 WHERE x.role_code = r.code;

SELECT audit.track('core.role', ARRAY['code'], false);
