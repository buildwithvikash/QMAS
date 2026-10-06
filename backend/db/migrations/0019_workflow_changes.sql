-- 0019 Workflow changes:
--   * a deviation goes to SCM and VD together; whoever accepts it first owns it (department and
--     initiator), so the department stays empty until then;
--   * every workflow step keeps the record's state from just before it, so an admin can reverse
--     a process to an earlier step;
--   * reversal requests: raised by the person responsible for the current step, with a reason;
--     reviewed by an admin; kept as an audit trail that cannot be changed afterwards.

ALTER TABLE qms.deviation ALTER COLUMN department DROP NOT NULL;
ALTER TABLE qms.deviation ADD COLUMN accepted_at timestamptz;
-- Deviations opened before this change were assigned to a department when they were held.
UPDATE qms.deviation SET accepted_at = created_at WHERE accepted_at IS NULL;

-- The record's state before the step (IMIR, deviation or DN columns), for reversal.
ALTER TABLE qms.imir_action ADD COLUMN snapshot jsonb;

INSERT INTO core.permission (key, module, description) VALUES
  ('workflow.reverse', 'Administration', 'Review reversal requests and reverse a workflow step')
ON CONFLICT (key) DO NOTHING;
-- System Admin holds it (on a new database the seed grants it, as the roles come later).
INSERT INTO core.role_permission (role_code, permission_key)
SELECT code, 'workflow.reverse' FROM core.role WHERE code = 'SYSTEM_ADMIN'
ON CONFLICT DO NOTHING;

CREATE TABLE qms.reversal_request (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type      text NOT NULL CHECK (entity_type IN ('IMIR', 'DEVIATION', 'DN')),
  entity_id        uuid NOT NULL,
  imir_id          uuid NOT NULL REFERENCES qms.imir (id),
  plant_id         smallint NOT NULL REFERENCES core.plant (id),
  record_no        text NOT NULL,
  status_at_request text NOT NULL,                 -- stage / status when the request was raised
  requested_step   bigint REFERENCES qms.imir_action (id), -- the step the requester asks to undo
  reason           text NOT NULL CHECK (length(btrim(reason)) > 0),
  requested_by     uuid NOT NULL REFERENCES core.app_user (id),
  requested_role   text,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  state            text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'REVERSED', 'REJECTED', 'WITHDRAWN')),
  reviewed_by      uuid REFERENCES core.app_user (id),
  reviewed_at      timestamptz,
  review_remark    text,
  undone_step      bigint REFERENCES qms.imir_action (id), -- the record was set back to just before this step
  previous_status  text,                            -- stage / status before the reversal
  reverted_status  text,                            -- stage / status after the reversal
  CHECK (state = 'PENDING' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (state <> 'REVERSED' OR (undone_step IS NOT NULL AND previous_status IS NOT NULL AND reverted_status IS NOT NULL))
);
CREATE UNIQUE INDEX reversal_one_pending ON qms.reversal_request (entity_type, entity_id) WHERE state = 'PENDING';
CREATE INDEX reversal_state_idx ON qms.reversal_request (state, requested_at DESC);
CREATE INDEX reversal_entity_idx ON qms.reversal_request (entity_id, requested_at DESC);
SELECT audit.track('qms.reversal_request', ARRAY['id'], false);

-- Audit trail: a request is decided once, then never changed or removed.
CREATE OR REPLACE FUNCTION qms.reversal_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'PENDING' THEN
    RAISE EXCEPTION 'A decided reversal request cannot be changed or deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reversal_request_guard BEFORE UPDATE OR DELETE ON qms.reversal_request
  FOR EACH ROW EXECUTE FUNCTION qms.reversal_request_guard();
