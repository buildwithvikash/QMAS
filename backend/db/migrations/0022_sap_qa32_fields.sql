-- 0022 SAP QA32 record ("SAP Data v1"): the Start of Inspection date is kept with the lot.
-- (Material Group goes to item_category; SAP sends no separate GRN date, so grn_date takes the
-- Start of Inspection too, and no invoice number.)
ALTER TABLE intg.sap_inspection_lot ADD COLUMN inspection_start date;
