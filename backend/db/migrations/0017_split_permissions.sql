-- 0017 Finer permissions, so each feature can be given on its own:
--   ai.assist (one switch for every AI feature) → one permission per feature;
--   formats.import (Excel bulk import) separated from formats.approve.
-- Nobody gains or loses anything: each role keeps what it could do before.
-- Descriptions and order are set by the reference-data seed that runs after the migrations.
INSERT INTO core.permission (key, module, description) VALUES
  ('ai.insights',       'AI Assistant',       'Quality Insights page'),
  ('ai.failure_chance', 'AI Assistant',       'Chance this lot fails on the IMIR page'),
  ('ai.imir_summary',   'AI Assistant',       'AI summary of an inspection'),
  ('ai.capa_review',    'AI Assistant',       'AI assessment of the vendor CAPA'),
  ('ai.root_cause',     'AI Assistant',       'AI root-cause suggestions'),
  ('ai.search',         'AI Assistant',       'Search in plain words'),
  ('ai.ask',            'AI Assistant',       'Ask QMAS'),
  ('ai.voice_tidy',     'AI Assistant',       'Tidy dictated observations with AI'),
  ('formats.import',    'Inspection Formats', 'Import formats in bulk from Excel')
ON CONFLICT (key) DO NOTHING;

-- Roles with ai.assist had every AI feature except tidying dictation (that came with imir.inspect).
INSERT INTO core.role_permission (role_code, permission_key)
SELECT rp.role_code, k
  FROM core.role_permission rp
 CROSS JOIN unnest(ARRAY['ai.insights', 'ai.failure_chance', 'ai.imir_summary', 'ai.capa_review', 'ai.root_cause', 'ai.search', 'ai.ask']) AS k
 WHERE rp.permission_key = 'ai.assist'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permission (role_code, permission_key)
SELECT role_code, 'ai.voice_tidy' FROM core.role_permission WHERE permission_key = 'imir.inspect'
ON CONFLICT DO NOTHING;

-- Import came with approval.
INSERT INTO core.role_permission (role_code, permission_key)
SELECT role_code, 'formats.import' FROM core.role_permission WHERE permission_key = 'formats.approve'
ON CONFLICT DO NOTHING;

DELETE FROM core.permission WHERE key = 'ai.assist'; -- its grants go with it (ON DELETE CASCADE)
