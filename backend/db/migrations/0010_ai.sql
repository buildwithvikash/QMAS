-- 0010 AI assistance: the permission for Incharge-and-above AI features, a cache of AI results
-- (so a summary or CAPA assessment is not paid for twice while its inputs are unchanged), and a
-- log of every call to the model for cost and troubleshooting.

INSERT INTO core.permission (key, module, description, sort_order)
VALUES ('ai.assist', 'AI Assistant', 'Use AI summaries, CAPA assessment, root-cause suggestions, search in words and the quality chatbot', 900)
ON CONFLICT (key) DO NOTHING;

-- Existing databases: grant it to Incharge and above. A fresh database gets it from the seed.
INSERT INTO core.role_permission (role_code, permission_key)
SELECT code, 'ai.assist' FROM core.role
 WHERE code IN ('SYSTEM_ADMIN', 'IQC_INCHARGE', 'IQC_HEAD', 'PLANT_HEAD', 'PLANT_QA_HEAD', 'PDC_HEAD', 'CQA_HEAD', 'CENTRAL_OPS_HEAD', 'PLANT_OPS_HEAD')
ON CONFLICT DO NOTHING;

-- One row per generated result; `input_hash` identifies the data it was made from.
CREATE TABLE qms.ai_result (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('IMIR_SUMMARY', 'CAPA_ASSESSMENT', 'ROOT_CAUSE')),
  entity_id   uuid NOT NULL,
  input_hash  text NOT NULL,
  output      jsonb NOT NULL,
  model       text NOT NULL,
  created_by  uuid REFERENCES core.app_user (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_result_lookup_idx ON qms.ai_result (kind, entity_id, created_at DESC);

CREATE TABLE core.ai_call (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  user_id       uuid REFERENCES core.app_user (id),
  feature       text NOT NULL,
  model         text NOT NULL,
  input_tokens  integer,
  output_tokens integer,
  duration_ms   integer NOT NULL,
  ok            boolean NOT NULL,
  error         text
);
CREATE INDEX ai_call_at_idx ON core.ai_call (at DESC);
