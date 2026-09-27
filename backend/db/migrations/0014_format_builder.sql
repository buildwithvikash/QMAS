-- 0014 Format builder and format history.
--
-- Builder: a checkpoint can sit in a section with its own heading (group_label), take a field type
-- (input_type), offer options that pass or fail, be optional, and carry help for the inspector.
-- A new section RECORD holds lot details recorded once per lot (text, number, date, yes / no,
-- choice). Existing checkpoints get the field type their section always had.
--
-- History: every step on a format (draft started, saved with what changed, submitted, returned,
-- approved or merged, conflicts resolved, discarded, imported) is kept in qms.format_event.

ALTER TABLE qms.format_checkpoint
  ADD COLUMN group_label text,
  ADD COLUMN input_type  text,
  ADD COLUMN options     jsonb,
  ADD COLUMN is_required boolean NOT NULL DEFAULT true,
  ADD COLUMN help_text   text;

UPDATE qms.format_checkpoint
   SET input_type = CASE section WHEN 'DIMENSIONAL' THEN 'MEASURE' WHEN 'VISUAL' THEN 'OK_NOK' ELSE 'LOT_TEST' END;
ALTER TABLE qms.format_checkpoint ALTER COLUMN input_type SET NOT NULL;

ALTER TABLE qms.format_checkpoint DROP CONSTRAINT format_checkpoint_section_check;
ALTER TABLE qms.format_checkpoint ADD CONSTRAINT format_checkpoint_section_check
  CHECK (section IN ('DIMENSIONAL', 'VISUAL', 'RELIABILITY', 'RECORD'));
-- Limits: measurements, and number fields of lot details.
ALTER TABLE qms.format_checkpoint DROP CONSTRAINT format_checkpoint_check2;
ALTER TABLE qms.format_checkpoint ADD CONSTRAINT format_checkpoint_limits_check
  CHECK (section = 'DIMENSIONAL' OR input_type = 'NUMBER' OR (lsl IS NULL AND usl IS NULL AND nominal IS NULL));
ALTER TABLE qms.format_checkpoint ADD CONSTRAINT format_checkpoint_input_type_check CHECK (
  (section = 'DIMENSIONAL' AND input_type = 'MEASURE')
  OR (section = 'VISUAL' AND input_type IN ('OK_NOK', 'CHOICE'))
  OR (section = 'RELIABILITY' AND input_type = 'LOT_TEST')
  OR (section = 'RECORD' AND input_type IN ('TEXT', 'NUMBER', 'DATE', 'YES_NO', 'CHOICE')));
ALTER TABLE qms.format_checkpoint ADD CONSTRAINT format_checkpoint_options_check
  CHECK ((input_type IN ('CHOICE', 'YES_NO')) = (options IS NOT NULL AND jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2));

ALTER TABLE qms.imir_checkpoint DROP CONSTRAINT imir_checkpoint_section_check;
ALTER TABLE qms.imir_checkpoint ADD CONSTRAINT imir_checkpoint_section_check
  CHECK (section IN ('DIMENSIONAL', 'VISUAL', 'RELIABILITY', 'RECORD'));

-- Formats built in the builder from scratch.
ALTER TABLE qms.format_version DROP CONSTRAINT format_version_source_check;
ALTER TABLE qms.format_version ADD CONSTRAINT format_version_source_check
  CHECK (source IN ('NEW', 'CURRENT', 'SAN', 'CLONE', 'PRE_FED', 'CUSTOM'));

CREATE TABLE qms.format_event (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  format_id  uuid NOT NULL REFERENCES qms.format (id) ON DELETE CASCADE,
  version_id uuid REFERENCES qms.format_version (id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('CREATED', 'SAVED', 'SUBMITTED', 'RETURNED', 'APPROVED', 'MERGED', 'CONFLICT',
                                             'RESOLVED', 'DISCARDED', 'IMPORTED')),
  actor_id   uuid REFERENCES core.app_user (id),
  remark     text,
  -- What changed (SAVED: field-level diff against the previous save; APPROVED: version number, ...).
  detail     jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX format_event_format_idx ON qms.format_event (format_id, at DESC);
CREATE INDEX format_event_version_idx ON qms.format_event (version_id, at);

-- History of formats that existed before this release, from their versions' own time stamps.
INSERT INTO qms.format_event (format_id, version_id, action, actor_id, detail, at)
SELECT v.format_id, v.id, CASE v.source WHEN 'PRE_FED' THEN 'IMPORTED' ELSE 'CREATED' END, v.created_by,
       jsonb_build_object('source', v.source, 'baseVersionNo', bv.version_no, 'checkpoints', (SELECT count(*) FROM qms.format_checkpoint c WHERE c.version_id = v.id)),
       v.created_at
  FROM qms.format_version v LEFT JOIN qms.format_version bv ON bv.id = v.base_version_id;
INSERT INTO qms.format_event (format_id, version_id, action, actor_id, at)
SELECT v.format_id, v.id, 'SUBMITTED', v.submitted_by, v.submitted_at FROM qms.format_version v WHERE v.submitted_at IS NOT NULL;
INSERT INTO qms.format_event (format_id, version_id, action, actor_id, remark, detail, at)
SELECT v.format_id, v.id, CASE WHEN v.merge_note LIKE 'Merged%' THEN 'MERGED' ELSE 'APPROVED' END, v.decided_by, v.decision_remark,
       jsonb_build_object('versionNo', v.version_no, 'note', v.merge_note), v.decided_at
  FROM qms.format_version v WHERE v.version_no IS NOT NULL AND v.decided_at IS NOT NULL;
INSERT INTO qms.format_event (format_id, version_id, action, actor_id, remark, at)
SELECT v.format_id, v.id, 'RETURNED', v.decided_by, v.decision_remark, v.decided_at
  FROM qms.format_version v WHERE v.status = 'REJECTED' AND v.decided_at IS NOT NULL;
INSERT INTO qms.format_event (format_id, version_id, action, actor_id, at)
SELECT v.format_id, v.id, 'DISCARDED', v.updated_by, v.updated_at FROM qms.format_version v WHERE v.status = 'DISCARDED';
