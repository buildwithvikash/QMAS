-- 0006 SAP inward lots, IMIR, inspection observations, attachments, reliability log,
-- tablets and offline sync.

-- ── SAP (QA32) staging ─────────────────────────────────────────────────────────
CREATE TABLE intg.sap_sync_run (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL CHECK (status IN ('RUNNING', 'OK', 'PARTIAL', 'FAILED')),
  source       text NOT NULL,                  -- adapter: mock | sap
  cursor_value text,                           -- where the next pull continues
  fetched      integer NOT NULL DEFAULT 0,
  created_lots integer NOT NULL DEFAULT 0,
  opened_imirs integer NOT NULL DEFAULT 0,
  errors       jsonb NOT NULL DEFAULT '[]',
  triggered_by uuid REFERENCES core.app_user (id)
);
CREATE INDEX sap_sync_run_started_idx ON intg.sap_sync_run (started_at DESC);

-- Every QA32 inspection lot as received (one row per SAP inspection lot).
CREATE TABLE intg.sap_inspection_lot (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sap_lot_no       text NOT NULL UNIQUE,
  plant_sap_code   text NOT NULL,
  grn_no           text NOT NULL,
  grn_date         date NOT NULL,
  invoice_no       text,
  vendor_code      text NOT NULL,
  vendor_name      text,
  item_code        text NOT NULL,
  item_description text,
  item_category    text,
  uom              text,
  inward_qty       numeric(14, 3) NOT NULL CHECK (inward_qty > 0),
  payload          jsonb NOT NULL,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  sync_run_id      bigint REFERENCES intg.sap_sync_run (id)
);

-- Mock SAP queue (development and tests only; the real adapter reads SAP instead).
CREATE TABLE intg.sap_mock_lot (
  seq        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sap_lot_no text NOT NULL UNIQUE,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES core.app_user (id)
);

-- ── IMIR ───────────────────────────────────────────────────────────────────────
CREATE TABLE qms.imir (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imir_no               text UNIQUE,                    -- issued when the IMIR opens
  sap_lot_id            bigint NOT NULL UNIQUE REFERENCES intg.sap_inspection_lot (id),
  plant_id              smallint NOT NULL REFERENCES core.plant (id),
  item_id               bigint   NOT NULL REFERENCES mst.item (id),
  vendor_id             integer  NOT NULL REFERENCES mst.vendor (id),
  grn_no                text NOT NULL,
  grn_date              date NOT NULL,
  invoice_no            text,
  inward_qty            numeric(14, 3) NOT NULL CHECK (inward_qty > 0),
  uom                   text,
  status                text NOT NULL CHECK (status IN (
                          'AWAITING_FORMAT', 'OPEN', 'IN_INSPECTION', 'SUBMITTED', 'WITH_IQC_HEAD', 'DEPT_REVIEW', 'IQC_HEAD_FINAL',
                          'SENIOR_ESCALATION', 'UNDER_DEVIATION', 'QTY_VERIFICATION', 'CLOSED_ACCEPTED', 'CLOSED_REJECTED',
                          'CLOSED_UNDER_DEVIATION', 'AUTO_CLOSED')),
  awaiting_reason       text,
  format_version_id     uuid REFERENCES qms.format_version (id),   -- pinned when opened; approved versions never change
  sampling_plan_id      smallint REFERENCES mst.sampling_plan (id),
  lot_size              integer,
  sample_size           smallint CHECK (sample_size BETWEEN 1 AND 8),
  accept_no             smallint,
  reject_no             smallint,
  sampling_basis        text CHECK (sampling_basis IN ('TABLE', 'FULL_LOT')),
  model                 text,
  inspector_remark      text,
  result                text CHECK (result IN ('OK', 'NOK')),
  defective_samples     smallint[],
  opened_at             timestamptz,
  inspection_started_at timestamptz,
  inspected_by          uuid REFERENCES core.app_user (id),
  submitted_at          timestamptz,
  submitted_by          uuid REFERENCES core.app_user (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES core.app_user (id),
  updated_by            uuid REFERENCES core.app_user (id),
  row_version           integer NOT NULL DEFAULT 1,
  CHECK (status = 'AWAITING_FORMAT' OR (imir_no IS NOT NULL AND format_version_id IS NOT NULL AND sample_size IS NOT NULL)),
  CHECK (status IN ('AWAITING_FORMAT', 'OPEN', 'IN_INSPECTION') OR (result IS NOT NULL AND submitted_at IS NOT NULL))
);
CREATE INDEX imir_plant_status_idx ON qms.imir (plant_id, status, created_at DESC);
CREATE INDEX imir_open_idx ON qms.imir (plant_id, created_at) WHERE status IN ('AWAITING_FORMAT', 'OPEN', 'IN_INSPECTION');
CREATE INDEX imir_item_idx ON qms.imir (item_id, created_at DESC);
CREATE INDEX imir_awaiting_item_idx ON qms.imir (item_id) WHERE status = 'AWAITING_FORMAT';
CREATE INDEX imir_no_trgm ON qms.imir USING gin (imir_no gin_trgm_ops);
CREATE INDEX imir_grn_idx ON qms.imir (grn_no);
SELECT audit.track('qms.imir');

-- Per-checkpoint state of an IMIR: reliability due flag, text observation, manual/derived result, remarks.
CREATE TABLE qms.imir_checkpoint (
  imir_id          uuid NOT NULL REFERENCES qms.imir (id) ON DELETE CASCADE,
  checkpoint_uid   uuid NOT NULL,
  section          text NOT NULL CHECK (section IN ('DIMENSIONAL', 'VISUAL', 'RELIABILITY')),
  is_required      boolean NOT NULL DEFAULT true,     -- false: reliability test not due
  last_tested_at   timestamptz,                      -- reliability: previous test shown to the inspector
  text_observation text,
  manual_result    text CHECK (manual_result IN ('OK', 'NOK')),
  result           text CHECK (result IN ('OK', 'NOK')),
  inspector_remark text,
  incharge_remark  text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES core.app_user (id),
  PRIMARY KEY (imir_id, checkpoint_uid)
);

-- One reading per checkpoint and sample (≤ 8 samples).
CREATE TABLE qms.imir_observation (
  imir_id        uuid NOT NULL REFERENCES qms.imir (id) ON DELETE CASCADE,
  checkpoint_uid uuid NOT NULL,
  sample_no      smallint NOT NULL CHECK (sample_no BETWEEN 1 AND 8),
  value_num      numeric(12, 3),
  value_ok       boolean,
  decision       text CHECK (decision IN ('OK', 'NOK')),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  client_time    timestamptz,                         -- when the tablet recorded it (offline)
  recorded_by    uuid REFERENCES core.app_user (id),
  device_id      uuid,
  PRIMARY KEY (imir_id, checkpoint_uid, sample_no),
  CHECK (value_num IS NULL OR value_ok IS NULL)
);

-- Photos / PDFs (visual samples now; DN and CAPA later).
CREATE TABLE qms.attachment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('IMIR_OBSERVATION', 'DN', 'CAPA', 'DEVIATION')),
  entity_id   uuid NOT NULL,
  ref         text,                                   -- e.g. "<checkpoint uid>:<sample no>"
  file_name   text NOT NULL,
  mime_type   text NOT NULL,
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  sha256      text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  captured_at timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES core.app_user (id),
  deleted_at  timestamptz,
  deleted_by  uuid REFERENCES core.app_user (id)
);
CREATE INDEX attachment_entity_idx ON qms.attachment (entity_type, entity_id) WHERE deleted_at IS NULL;
SELECT audit.track('qms.attachment', ARRAY['id'], false);

-- Reliability tests done, per item + vendor + checkpoint (Decisions B-10, B-21 default).
CREATE TABLE qms.reliability_test_log (
  item_id        bigint  NOT NULL REFERENCES mst.item (id),
  vendor_id      integer NOT NULL REFERENCES mst.vendor (id),
  checkpoint_uid uuid    NOT NULL,
  imir_id        uuid    NOT NULL REFERENCES qms.imir (id),
  tested_at      timestamptz NOT NULL,
  result         text NOT NULL CHECK (result IN ('OK', 'NOK')),
  PRIMARY KEY (item_id, vendor_id, checkpoint_uid, imir_id)
);
CREATE INDEX reliability_latest_idx ON qms.reliability_test_log (item_id, vendor_id, checkpoint_uid, tested_at DESC);

-- ── Tablets and offline sync ───────────────────────────────────────────────────
CREATE TABLE core.device (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code   text NOT NULL UNIQUE CHECK (device_code ~ '^[A-Z0-9-]+$'),
  name          text NOT NULL,
  plant_id      smallint NOT NULL REFERENCES core.plant (id),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES core.app_user (id),
  updated_by    uuid REFERENCES core.app_user (id),
  row_version   integer NOT NULL DEFAULT 1
);
SELECT audit.track('core.device');

-- Last contact per tablet, kept apart so heartbeats neither bump the device's row version
-- (which would make admin edits stale) nor fill the audit trail.
CREATE TABLE core.device_activity (
  device_id    uuid PRIMARY KEY REFERENCES core.device (id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL,
  last_user_id uuid REFERENCES core.app_user (id)
);

-- An IMIR checked out to a tablet: only that device may record observations until released.
CREATE TABLE qms.imir_checkout (
  imir_id        uuid PRIMARY KEY REFERENCES qms.imir (id) ON DELETE CASCADE,
  device_id      uuid NOT NULL REFERENCES core.device (id),
  user_id        uuid NOT NULL REFERENCES core.app_user (id),
  checked_out_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX imir_checkout_device_idx ON qms.imir_checkout (device_id);
SELECT audit.track('qms.imir_checkout', ARRAY['imir_id'], false);

-- Every offline operation received, so a replay is recognised and answered the same way.
CREATE TABLE sync.client_op (
  op_id       uuid PRIMARY KEY,
  device_id   uuid NOT NULL REFERENCES core.device (id),
  user_id     uuid NOT NULL REFERENCES core.app_user (id),
  imir_id     uuid,
  op_type     text NOT NULL,
  client_time timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  outcome     text NOT NULL CHECK (outcome IN ('ACCEPTED', 'CONFLICT', 'REJECTED')),
  detail      jsonb
);
CREATE INDEX client_op_device_idx ON sync.client_op (device_id, received_at DESC);
