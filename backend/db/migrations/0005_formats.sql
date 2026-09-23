-- 0005 Inspection formats with Git-style versioning (Decisions 1, 2, 13).
-- One format per item code. Each change is a version: drafts branch from the approved version
-- they were started from (base_version_id); approval either fast-forwards or merges.

CREATE TABLE qms.format (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id            bigint NOT NULL UNIQUE REFERENCES mst.item (id),
  current_version_id uuid,          -- the APPROVED version (FK added below)
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES core.app_user (id)
);

CREATE TABLE qms.format_version (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  format_id       uuid NOT NULL REFERENCES qms.format (id),
  version_no      integer CHECK (version_no >= 1),          -- assigned on approval
  status          text NOT NULL CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CONFLICT', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'DISCARDED')),
  source          text NOT NULL CHECK (source IN ('NEW', 'CURRENT', 'SAN', 'CLONE', 'PRE_FED')),
  source_ref      jsonb,                                     -- e.g. SAN reference, cloned version, import file
  base_version_id uuid REFERENCES qms.format_version (id),   -- approved version this draft branched from
  format_no       text,
  common_format_no text,
  ref_standard    text,
  remarks         text,
  merge_note      text,                                      -- how approval merged it, for history
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES core.app_user (id),
  submitted_at    timestamptz,
  submitted_by    uuid REFERENCES core.app_user (id),
  decided_at      timestamptz,
  decided_by      uuid REFERENCES core.app_user (id),
  decision_remark text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES core.app_user (id),
  row_version     integer NOT NULL DEFAULT 1,
  CHECK ((status IN ('APPROVED', 'SUPERSEDED')) = (version_no IS NOT NULL)),
  CHECK (status NOT IN ('PENDING_APPROVAL', 'CONFLICT') OR submitted_at IS NOT NULL)
);
ALTER TABLE qms.format ADD CONSTRAINT format_current_version_fk FOREIGN KEY (current_version_id) REFERENCES qms.format_version (id);

-- Exactly one approved version per item code at a time; version numbers unique per format.
CREATE UNIQUE INDEX format_version_one_approved ON qms.format_version (format_id) WHERE status = 'APPROVED';
CREATE UNIQUE INDEX format_version_no_unique ON qms.format_version (format_id, version_no) WHERE version_no IS NOT NULL;
-- Approval queue: oldest submission first (blueprint Cases 3–4).
CREATE INDEX format_version_queue_idx ON qms.format_version (submitted_at) WHERE status IN ('PENDING_APPROVAL', 'CONFLICT');
CREATE INDEX format_version_open_idx ON qms.format_version (format_id, status) WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'CONFLICT', 'REJECTED');
SELECT audit.track('qms.format_version');

CREATE TABLE qms.format_checkpoint (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       uuid NOT NULL REFERENCES qms.format_version (id) ON DELETE CASCADE,
  checkpoint_uid   uuid NOT NULL,                  -- stable across versions
  section          text NOT NULL CHECK (section IN ('DIMENSIONAL', 'VISUAL', 'RELIABILITY')),
  seq              smallint NOT NULL CHECK (seq >= 1),
  checkpoint       text NOT NULL,
  specification    text,
  nominal          numeric(12, 3),
  lsl              numeric(12, 3),
  usl              numeric(12, 3),
  uom              text,
  instrument       text,
  frequency_months smallint CHECK (frequency_months BETWEEN 1 AND 60),
  UNIQUE (version_id, checkpoint_uid),
  CHECK (lsl IS NULL OR usl IS NULL OR lsl <= usl),
  CHECK (section <> 'DIMENSIONAL' OR lsl IS NOT NULL OR usl IS NOT NULL),
  CHECK (section = 'DIMENSIONAL' OR (lsl IS NULL AND usl IS NULL AND nominal IS NULL)),
  CHECK (section = 'RELIABILITY' OR frequency_months IS NULL)
);
CREATE INDEX format_checkpoint_version_idx ON qms.format_checkpoint (version_id, section, seq);
-- Checkpoint rows are replaced wholesale on each draft save; the version row's audit covers who/when.

-- Conflicts found when approving a draft whose base is no longer the approved version.
CREATE TABLE qms.format_merge_conflict (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id         uuid NOT NULL REFERENCES qms.format_version (id) ON DELETE CASCADE,
  against_version_id uuid NOT NULL REFERENCES qms.format_version (id),
  checkpoint_uid     uuid,                         -- NULL for header fields
  field              text NOT NULL,
  label              text,                         -- checkpoint name, for display
  base_value         jsonb,
  theirs_value       jsonb,                        -- approved version
  mine_value         jsonb,                        -- draft
  resolution         text CHECK (resolution IN ('THEIRS', 'MINE', 'CUSTOM')),
  resolved_value     jsonb,
  resolved_by        uuid REFERENCES core.app_user (id),
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX format_merge_conflict_open_idx ON qms.format_merge_conflict (version_id) WHERE resolved_at IS NULL;

-- SAN/SIR calls, so a format built from SAN data can be traced to what SAN returned.
CREATE TABLE intg.san_lookup_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  vendor_code  text NOT NULL,
  item_code    text NOT NULL,
  found        boolean NOT NULL,
  reference    text,
  response     jsonb,
  duration_ms  integer,
  requested_by uuid REFERENCES core.app_user (id)
);
CREATE INDEX san_lookup_log_item_idx ON intg.san_lookup_log (item_code, at DESC);
