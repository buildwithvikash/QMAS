-- 0004 Configurable document numbering (Decision 9).
-- A series says how numbers look; counters say how far each plant has got in each period.
-- issued_doc_no is the final guard: a number can never be issued twice, even if an admin
-- changes the pattern or reset scope in the middle of a period.

CREATE TABLE core.number_series (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_type       text NOT NULL CHECK (doc_type IN ('IMIR', 'DN', 'DEVIATION')),
  plant_id       smallint REFERENCES core.plant (id),  -- NULL = default for every plant
  pattern        text NOT NULL CHECK (length(pattern) BETWEEN 3 AND 80),
  reset_scope    text NOT NULL CHECK (reset_scope IN ('DAY', 'MONTH', 'YEAR', 'NEVER')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  is_active      boolean NOT NULL DEFAULT true,
  remarks        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES core.app_user (id),
  updated_by     uuid REFERENCES core.app_user (id),
  row_version    integer NOT NULL DEFAULT 1
);
CREATE INDEX number_series_lookup_idx ON core.number_series (doc_type, plant_id, effective_from DESC) WHERE is_active;
SELECT audit.track('core.number_series');

CREATE TABLE core.doc_counter (
  doc_type   text     NOT NULL,
  plant_id   smallint NOT NULL REFERENCES core.plant (id),
  period_key text     NOT NULL,
  last_no    integer  NOT NULL CHECK (last_no >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, plant_id, period_key)
);

CREATE TABLE core.issued_doc_no (
  doc_type  text NOT NULL,
  doc_no    text NOT NULL,
  plant_id  smallint NOT NULL REFERENCES core.plant (id),
  series_id integer  NOT NULL REFERENCES core.number_series (id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES core.app_user (id),
  PRIMARY KEY (doc_type, doc_no)
);
CREATE INDEX issued_doc_no_series_idx ON core.issued_doc_no (series_id);
