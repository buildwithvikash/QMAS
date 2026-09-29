-- 0018 Close empty drafts that were started before the version now approved (for example an item
-- imported from Excel after someone had opened the builder). They were never filled in; opening one
-- showed an empty "first format" instead of the approved format. From now on this happens
-- automatically when a version is approved or imported. Drafts with checkpoints are left alone.
WITH closed AS (
  UPDATE qms.format_version v SET status = 'DISCARDED'
    FROM qms.format f
   WHERE f.id = v.format_id AND f.current_version_id IS NOT NULL
     AND v.status = 'DRAFT' AND v.id <> f.current_version_id
     AND v.base_version_id IS DISTINCT FROM f.current_version_id
     AND NOT EXISTS (SELECT 1 FROM qms.format_checkpoint c WHERE c.version_id = v.id)
  RETURNING v.id, v.format_id
)
INSERT INTO qms.format_event (format_id, version_id, action, remark)
SELECT format_id, id, 'DISCARDED', 'Empty draft closed: a newer version was approved' FROM closed;
