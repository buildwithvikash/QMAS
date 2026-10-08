-- One inspector at a time per lot: the inspector who is entering the readings (claimed_by) and
-- when they last saved (claimed_at). Others may look but not record until they take the lot over
-- (logged as TAKE_OVER) or the claim lapses (INSPECTION_CLAIM_MINUTES without a save).
ALTER TABLE qms.imir
  ADD COLUMN claimed_by uuid REFERENCES core.app_user (id),
  ADD COLUMN claimed_at timestamptz;

-- Lots being inspected now belong to whoever started them.
UPDATE qms.imir SET claimed_by = inspected_by, claimed_at = updated_at
 WHERE status = 'IN_INSPECTION' AND inspected_by IS NOT NULL;
