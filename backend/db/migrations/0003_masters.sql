-- 0003 Master data: UOM, instruments, item categories, vendors, items, deviation lookups,
-- escalation hierarchy, sampling table.

CREATE TABLE mst.uom (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code = upper(code) AND length(code) BETWEEN 1 AND 20),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.app_user (id),
  updated_by  uuid REFERENCES core.app_user (id),
  row_version integer NOT NULL DEFAULT 1
);
SELECT audit.track('mst.uom');

CREATE TABLE mst.instrument (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code = upper(code) AND length(code) BETWEEN 1 AND 20),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.app_user (id),
  updated_by  uuid REFERENCES core.app_user (id),
  row_version integer NOT NULL DEFAULT 1
);
SELECT audit.track('mst.instrument');

CREATE TABLE mst.item_category (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code = upper(code) AND length(code) BETWEEN 1 AND 20),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.app_user (id),
  updated_by  uuid REFERENCES core.app_user (id),
  row_version integer NOT NULL DEFAULT 1
);
SELECT audit.track('mst.item_category');

CREATE TABLE mst.vendor (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_code text NOT NULL UNIQUE CHECK (vendor_code = upper(vendor_code) AND length(vendor_code) BETWEEN 1 AND 20),
  name        text NOT NULL,
  source      text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('SAP', 'MANUAL')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.app_user (id),
  updated_by  uuid REFERENCES core.app_user (id),
  row_version integer NOT NULL DEFAULT 1
);
CREATE INDEX vendor_name_trgm ON mst.vendor USING gin (name gin_trgm_ops);
CREATE INDEX vendor_code_trgm ON mst.vendor USING gin (vendor_code gin_trgm_ops);
SELECT audit.track('mst.vendor');

-- One inspection format per item code (Decision 1); drawing data comes from Windchill.
CREATE TABLE mst.item (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_code           text NOT NULL UNIQUE CHECK (item_code = upper(item_code) AND length(item_code) BETWEEN 1 AND 40),
  description         text NOT NULL,
  category_id         integer  REFERENCES mst.item_category (id),
  uom_id              smallint REFERENCES mst.uom (id),
  drawing_no          text,
  drawing_rev         text,
  windchill_synced_at timestamptz,
  source              text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('SAP', 'MANUAL')),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES core.app_user (id),
  updated_by          uuid REFERENCES core.app_user (id),
  row_version         integer NOT NULL DEFAULT 1
);
CREATE INDEX item_code_trgm ON mst.item USING gin (item_code gin_trgm_ops);
CREATE INDEX item_description_trgm ON mst.item USING gin (description gin_trgm_ops);
CREATE INDEX item_category_idx ON mst.item (category_id);
SELECT audit.track('mst.item');

-- Fixed lists referenced by later modules (values seeded from @qmas/shared).
CREATE TABLE mst.deviation_action (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  sort_order smallint NOT NULL
);
CREATE TABLE mst.deviation_severity (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  sort_order smallint NOT NULL
);

-- Senior escalation hierarchy (slide 11): higher rank = higher authority.
CREATE TABLE mst.escalation_authority (
  role_code text PRIMARY KEY REFERENCES core.role (code),
  rank      smallint NOT NULL UNIQUE CHECK (rank BETWEEN 1 AND 20)
);

-- Sampling table from the Sampling Inspection Procedure. Ranges may not overlap within a plan
-- (enforced by the exclusion constraint); lot_max NULL = no upper limit.
CREATE TABLE mst.sampling_plan (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code = upper(code)),
  name        text NOT NULL,
  description text,
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.app_user (id),
  updated_by  uuid REFERENCES core.app_user (id),
  row_version integer NOT NULL DEFAULT 1,
  CHECK (NOT is_default OR is_active)
);
CREATE UNIQUE INDEX sampling_plan_single_default ON mst.sampling_plan (is_default) WHERE is_default;
SELECT audit.track('mst.sampling_plan');

CREATE TABLE mst.sampling_plan_row (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id     smallint NOT NULL REFERENCES mst.sampling_plan (id) ON DELETE CASCADE,
  lot_min     integer NOT NULL CHECK (lot_min >= 1),
  lot_max     integer CHECK (lot_max IS NULL OR lot_max >= lot_min),
  sample_size integer NOT NULL CHECK (sample_size >= 1),
  accept_no   integer,
  reject_no   integer,
  CHECK ((accept_no IS NULL) = (reject_no IS NULL)),
  CHECK (reject_no IS NULL OR (accept_no >= 0 AND reject_no > accept_no AND reject_no <= sample_size)),
  EXCLUDE USING gist (plan_id WITH =, int4range(lot_min, lot_max, '[]') WITH &&)
);
SELECT audit.track('mst.sampling_plan_row', ARRAY['id'], false);
