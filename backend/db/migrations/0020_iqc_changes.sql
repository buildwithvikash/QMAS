-- 0020 IQC workflow changes:
--   * AI features removed: their permissions go (grants with them). The tables of 0010 stay,
--     holding past results and the call log only.
--   * The IQC In-Charge's remark on the Deviation Form.

DELETE FROM core.permission WHERE key LIKE 'ai.%';

ALTER TABLE qms.deviation ADD COLUMN incharge_remark text;
ALTER TABLE qms.deviation ADD COLUMN incharge_remark_by uuid REFERENCES core.app_user (id);
ALTER TABLE qms.deviation ADD COLUMN incharge_remark_at timestamptz;
