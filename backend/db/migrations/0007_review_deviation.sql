-- 0007 IMIR review, deviation (SCM / VD), senior escalation, quantities, workflow history.

-- Every workflow step on an IMIR or its deviation, in order: who, as which role, what, why.
CREATE TABLE qms.imir_action (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  imir_id      uuid NOT NULL REFERENCES qms.imir (id) ON DELETE CASCADE,
  deviation_id uuid,
  action       text NOT NULL,
  from_status  text,
  to_status    text,
  actor_id     uuid REFERENCES core.app_user (id),
  acting_role  text,
  remark       text,
  payload      jsonb,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX imir_action_imir_idx ON qms.imir_action (imir_id, at);

-- Department approval levels after the initiator (Decision B-20: Sub-Head replaces the Head unless
-- the setting adds the Head).
CREATE TABLE mst.dept_approval_chain (
  department  text PRIMARY KEY CHECK (department IN ('SCM', 'VD')),
  levels      text[] NOT NULL CHECK (array_length(levels, 1) >= 1 AND levels <@ ARRAY['SUB_HEAD', 'HEAD']::text[]),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES core.app_user (id),
  row_version integer NOT NULL DEFAULT 1
);
INSERT INTO mst.dept_approval_chain (department, levels) VALUES ('SCM', '{SUB_HEAD}'), ('VD', '{SUB_HEAD}');
SELECT audit.track('mst.dept_approval_chain', ARRAY['department']);

CREATE TABLE qms.deviation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deviation_no      text NOT NULL UNIQUE,
  imir_id           uuid NOT NULL UNIQUE REFERENCES qms.imir (id),
  plant_id          smallint NOT NULL REFERENCES core.plant (id),
  department        text NOT NULL CHECK (department IN ('SCM', 'VD')),
  suggested_actions text[] NOT NULL CHECK (array_length(suggested_actions, 1) >= 1),
  hold_remark       text NOT NULL,
  stage             text NOT NULL CHECK (stage IN ('INITIATOR', 'SUB_HEAD', 'HEAD', 'FINAL', 'SENIOR', 'UNDER_DEVIATION', 'QTY_VERIFICATION', 'CLOSED')),
  dept_outcome      text CHECK (dept_outcome IN ('APPROVED', 'REJECTED', 'REJECT_RECOMMENDED')),
  approval_levels   text[],
  current_level     smallint,
  -- Deviation Form (review workbook)
  initiator_id      uuid REFERENCES core.app_user (id),
  severity          text REFERENCES mst.deviation_severity (code),
  action            text REFERENCES mst.deviation_action (code),
  deviation_qty     numeric(14, 3) CHECK (deviation_qty IS NULL OR deviation_qty > 0),
  specification     text,
  iqc_observation   text,
  correction        text,
  corrective_action text,
  form_submitted_at timestamptz,
  -- Decisions and quantities
  senior_effective  text CHECK (senior_effective IN ('APPROVE', 'REJECT', 'CHANGE_TYPE')),
  final_decision    text CHECK (final_decision IN ('APPROVED', 'REJECTED')),
  final_decision_at timestamptz,
  qty_due_at        timestamptz,
  ok_qty            numeric(14, 3) CHECK (ok_qty IS NULL OR ok_qty >= 0),
  not_ok_qty        numeric(14, 3) CHECK (not_ok_qty IS NULL OR not_ok_qty >= 0),
  qty_entered_at    timestamptz,
  qty_entered_by    uuid REFERENCES core.app_user (id),
  qty_verified_at   timestamptz,
  qty_verified_by   uuid REFERENCES core.app_user (id),
  outcome           text CHECK (outcome IN ('ACCEPTED_UNDER_DEVIATION', 'REJECTED', 'AUTO_CLOSED')),
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES core.app_user (id),
  updated_by        uuid REFERENCES core.app_user (id),
  row_version       integer NOT NULL DEFAULT 1,
  CHECK (stage <> 'CLOSED' OR outcome IS NOT NULL)
);
CREATE INDEX deviation_stage_idx ON qms.deviation (stage, department, plant_id) WHERE stage <> 'CLOSED';
CREATE INDEX deviation_qty_due_idx ON qms.deviation (qty_due_at) WHERE stage = 'UNDER_DEVIATION';
SELECT audit.track('qms.deviation');

-- Every submitted version of the Deviation Form.
CREATE TABLE qms.deviation_form_revision (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deviation_id uuid NOT NULL REFERENCES qms.deviation (id) ON DELETE CASCADE,
  revision_no  integer NOT NULL,
  data         jsonb NOT NULL,
  submitted_by uuid REFERENCES core.app_user (id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deviation_id, revision_no)
);

-- Senior escalation: rounds (a deviation can be escalated again after a change of type),
-- the authorities selected, and every decision.
CREATE TABLE qms.escalation_round (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deviation_id       uuid NOT NULL REFERENCES qms.deviation (id) ON DELETE CASCADE,
  round_no           integer NOT NULL,
  status             text NOT NULL CHECK (status IN ('OPEN', 'COMPLETE')),
  remark             text,
  effective_decision text CHECK (effective_decision IN ('APPROVE', 'REJECT', 'CHANGE_TYPE')),
  decided_by_role    text,
  opened_by          uuid REFERENCES core.app_user (id),
  opened_at          timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  UNIQUE (deviation_id, round_no)
);
CREATE UNIQUE INDEX escalation_one_open_round ON qms.escalation_round (deviation_id) WHERE status = 'OPEN';

CREATE TABLE qms.escalation_step (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id  bigint NOT NULL REFERENCES qms.escalation_round (id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES core.role (code),
  rank      smallint NOT NULL,
  status    text NOT NULL CHECK (status IN ('PENDING', 'DECIDED', 'TIMED_OUT', 'NOT_REQUIRED')),
  reason    text NOT NULL DEFAULT 'SELECTED' CHECK (reason IN ('SELECTED', 'AUTO_CQA')),
  due_at    timestamptz,                          -- Central Operations Head: 24 calendar hours
  UNIQUE (round_id, role_code)
);
CREATE INDEX escalation_step_due_idx ON qms.escalation_step (due_at) WHERE status = 'PENDING' AND due_at IS NOT NULL;

CREATE TABLE qms.escalation_decision (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id   bigint NOT NULL REFERENCES qms.escalation_round (id),
  role_code  text NOT NULL,
  decision   text NOT NULL CHECK (decision IN ('APPROVE', 'REJECT', 'CHANGE_TYPE')),
  kind       text NOT NULL DEFAULT 'NORMAL' CHECK (kind IN ('NORMAL', 'OVERRIDE')),
  remark     text,
  decided_by uuid NOT NULL REFERENCES core.app_user (id),
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX escalation_decision_round_idx ON qms.escalation_decision (round_id, decided_at);

-- Decisions are evidence: never changed or removed (Decision 5).
CREATE OR REPLACE FUNCTION qms.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows of % cannot be changed or deleted', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER escalation_decision_append_only BEFORE UPDATE OR DELETE ON qms.escalation_decision
  FOR EACH ROW EXECUTE FUNCTION qms.forbid_change();

-- When the IMIR reached a closed status.
ALTER TABLE qms.imir ADD COLUMN closed_at timestamptz;
CREATE INDEX imir_review_idx ON qms.imir (status, plant_id) WHERE status IN ('SUBMITTED', 'WITH_IQC_HEAD');
