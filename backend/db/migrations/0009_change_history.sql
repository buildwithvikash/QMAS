-- 0009 Change history: inspection readings and checkpoint entries join the audit trail, and each
-- workflow step records the request it came from, so the History panel can show a step together
-- with exactly the field changes it made.

-- Re-saving a reading only touches these; they are not changes worth a history line. The acting
-- user and time are already on every audit row.
CREATE OR REPLACE FUNCTION audit.strip(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT p - ARRAY['password_hash', 'token_hash', 'updated_at', 'updated_by', 'row_version',
                   'last_login_at', 'failed_login_count', 'locked_until',
                   'recorded_at', 'recorded_by', 'client_time', 'device_id']
$$;

SELECT audit.track('qms.imir_observation', ARRAY['imir_id', 'checkpoint_uid', 'sample_no'], false);
SELECT audit.track('qms.imir_checkpoint', ARRAY['imir_id', 'checkpoint_uid'], false);

ALTER TABLE qms.imir_action ADD COLUMN request_id text;
CREATE INDEX imir_action_request_idx ON qms.imir_action (request_id) WHERE request_id IS NOT NULL;
