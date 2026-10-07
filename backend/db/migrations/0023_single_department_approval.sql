-- 0023 Department approval is one step: the SCM / VD Sub-Head and Head are at the same level and
-- either of them approves, sends back or rejects a deviation. The configurable approval chain
-- (Sub-Head, optionally then Head) goes away.

-- Deviations waiting at the old Sub-Head step continue at the single department step.
UPDATE qms.deviation SET stage = 'HEAD', approval_levels = ARRAY['HEAD'], current_level = 0 WHERE stage = 'SUB_HEAD';

DROP TABLE mst.dept_approval_chain;
