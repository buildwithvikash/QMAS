-- 0015 Help & Support: tickets raised from inside QMAS (bug, problem, access request, question,
--   suggestion). The reporter follows their own tickets; holders of support.manage see all of
--   them, reply, assign, and move them through OPEN → IN_PROGRESS → (WAITING) → RESOLVED → CLOSED.
--   Every step is a row in support_event (the ticket's conversation and history).
CREATE SEQUENCE core.support_ticket_no_seq;

CREATE TABLE core.support_ticket (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no    text NOT NULL UNIQUE DEFAULT 'HLP-' || lpad(nextval('core.support_ticket_no_seq')::text, 5, '0'),
  kind         text NOT NULL CHECK (kind IN ('BUG', 'ISSUE', 'ACCESS', 'QUESTION', 'SUGGESTION')),
  module       text NOT NULL,
  priority     text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED')),
  title        text NOT NULL,
  description  text NOT NULL,
  steps        text,
  expected     text,
  reference    text,                -- IMIR / DN / deviation no. the problem is about, if any
  page_url     text,                -- the page the reporter was on
  client_info  jsonb,               -- browser, screen size, language (to reproduce display problems)
  reported_by  uuid NOT NULL REFERENCES core.app_user (id),
  assigned_to  uuid REFERENCES core.app_user (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  closed_at    timestamptz
);
ALTER SEQUENCE core.support_ticket_no_seq OWNED BY core.support_ticket.ticket_no;
CREATE INDEX support_ticket_reporter_idx ON core.support_ticket (reported_by, updated_at DESC);
CREATE INDEX support_ticket_status_idx ON core.support_ticket (status, updated_at DESC);
CREATE INDEX support_ticket_assignee_idx ON core.support_ticket (assigned_to) WHERE assigned_to IS NOT NULL;

-- Conversation and history. `internal` notes are seen by the support team only.
CREATE TABLE core.support_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES core.support_ticket (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('CREATED', 'COMMENT', 'STATUS', 'PRIORITY', 'ASSIGNED', 'FILE')),
  body        text,
  from_value  text,
  to_value    text,
  internal    boolean NOT NULL DEFAULT false,
  actor_id    uuid REFERENCES core.app_user (id),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_event_ticket_idx ON core.support_event (ticket_id, id);

-- Screenshots / files on a ticket (stored like other attachments, via the storage adapter).
CREATE TABLE core.support_attachment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES core.support_ticket (id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  sha256       text NOT NULL,
  storage_key  text NOT NULL UNIQUE,
  uploaded_by  uuid REFERENCES core.app_user (id),
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_attachment_ticket_idx ON core.support_attachment (ticket_id);

SELECT audit.track('core.support_ticket', ARRAY['id'], false);
