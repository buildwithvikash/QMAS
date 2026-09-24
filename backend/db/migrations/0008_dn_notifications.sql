-- 0008 Defect Notification (DN) with CAPA cycles, in-app notifications and the mail outbox.

-- ── Defect Notification (slide 13; review workbook "DN format", Incoming variant) ────────────
CREATE TABLE qms.defect_notification (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dn_no            text NOT NULL UNIQUE,
  variant          text NOT NULL DEFAULT 'INCOMING' CHECK (variant IN ('INCOMING', 'LINE_LAB_FIELD')), -- Line/Lab/Field: later release
  source           text NOT NULL DEFAULT 'IL' CHECK (source IN ('IL', 'LN', 'RL', 'FD')),
  imir_id          uuid REFERENCES qms.imir (id),
  plant_id         smallint NOT NULL REFERENCES core.plant (id),
  item_id          bigint NOT NULL REFERENCES mst.item (id),
  vendor_id        integer NOT NULL REFERENCES mst.vendor (id),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CAPA_SUBMITTED', 'CLOSED')),
  dn_date          timestamptz NOT NULL DEFAULT now(),       -- stamped once; basis for CAPA ageing
  model            text,
  received_qty     numeric(14, 3) CHECK (received_qty IS NULL OR received_qty >= 0),
  checked_qty      numeric(14, 3) CHECK (checked_qty IS NULL OR checked_qty >= 0),
  defective_qty    numeric(14, 3) CHECK (defective_qty IS NULL OR defective_qty >= 0),
  capa_applicable  boolean NOT NULL DEFAULT true,
  defect           text,                                      -- defect description (IQC)
  correction       text,                                      -- immediate correction (IQC)
  capa_due_at      timestamptz,                               -- DN date + 3 days when CAPA applies
  last_reminder_at timestamptz,
  closed_at        timestamptz,
  closed_by        uuid REFERENCES core.app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES core.app_user (id),
  updated_by       uuid REFERENCES core.app_user (id),
  row_version      integer NOT NULL DEFAULT 1,
  CHECK (defective_qty IS NULL OR checked_qty IS NULL OR defective_qty <= checked_qty),
  CHECK (checked_qty IS NULL OR received_qty IS NULL OR checked_qty <= received_qty),
  CHECK (variant <> 'INCOMING' OR imir_id IS NOT NULL),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX dn_one_per_imir ON qms.defect_notification (imir_id) WHERE imir_id IS NOT NULL;
CREATE INDEX dn_status_idx ON qms.defect_notification (plant_id, status, dn_date DESC);
CREATE INDEX dn_capa_due_idx ON qms.defect_notification (capa_due_at) WHERE status = 'OPEN' AND capa_applicable;
CREATE INDEX dn_vendor_idx ON qms.defect_notification (vendor_id, dn_date DESC);
SELECT audit.track('qms.defect_notification');

-- Parameter / specification / defect table of the DN.
CREATE TABLE qms.dn_defect_line (
  dn_id         uuid NOT NULL REFERENCES qms.defect_notification (id) ON DELETE CASCADE,
  line_no       smallint NOT NULL CHECK (line_no BETWEEN 1 AND 50),
  parameter     text NOT NULL,
  specification text,
  observation   text,
  PRIMARY KEY (dn_id, line_no)
);

-- Each CAPA submission and its review; a resubmission starts a new cycle.
CREATE TABLE qms.dn_capa (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dn_id             uuid NOT NULL REFERENCES qms.defect_notification (id) ON DELETE CASCADE,
  cycle_no          smallint NOT NULL,
  root_cause        text,
  corrective_action text,
  target_date       date,
  closing_date      date,
  responsibility    text,
  remark            text,
  submitted_by      uuid NOT NULL REFERENCES core.app_user (id),
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  review_decision   text CHECK (review_decision IN ('APPROVED', 'RESUBMIT')),
  review_remark     text,
  reviewed_by       uuid REFERENCES core.app_user (id),
  reviewed_at       timestamptz,
  UNIQUE (dn_id, cycle_no)
);
SELECT audit.track('qms.dn_capa', ARRAY['id'], false);

-- DN steps share the lot's workflow history.
ALTER TABLE qms.imir_action ADD COLUMN dn_id uuid REFERENCES qms.defect_notification (id);
CREATE INDEX imir_action_dn_idx ON qms.imir_action (dn_id, at) WHERE dn_id IS NOT NULL;

-- ── Notifications ──────────────────────────────────────────────────────────────────────────
-- In-app bell. Written in the same transaction as the workflow step that caused it.
CREATE TABLE core.notification (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES core.app_user (id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notification_user_idx ON core.notification (user_id, created_at DESC);
CREATE INDEX notification_unread_idx ON core.notification (user_id) WHERE read_at IS NULL;

-- Mail outbox: queued with the business change, sent by the worker after commit, retried on failure.
CREATE TABLE core.mail_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_address      text NOT NULL,
  to_user_id      uuid REFERENCES core.app_user (id) ON DELETE SET NULL,
  subject         text NOT NULL,
  body_text       text NOT NULL,
  body_html       text NOT NULL,
  attachment      jsonb,                                  -- rendered at send time, e.g. {"type":"DN_PDF","id":"…"}
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX mail_outbox_pending_idx ON core.mail_outbox (next_attempt_at) WHERE status = 'PENDING';
