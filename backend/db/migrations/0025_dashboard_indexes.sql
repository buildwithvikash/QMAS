-- Capacity: the Home dashboard and reports filter lots by date, often over every plant (most roles
-- see all plants). Without these indexes each call read the whole qms.imir table (≈2.2 M rows a
-- year at 6,000 lots a day).
CREATE INDEX imir_created_idx ON qms.imir (created_at);
CREATE INDEX imir_plant_created_idx ON qms.imir (plant_id, created_at);
-- Lots still in the workflow (a small share of the table): open-lot counts and ageing.
CREATE INDEX imir_active_status_idx ON qms.imir (status)
  WHERE status NOT IN ('CLOSED_ACCEPTED', 'CLOSED_REJECTED', 'CLOSED_UNDER_DEVIATION', 'AUTO_CLOSED');
