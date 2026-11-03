-- Checklist codes move from CHECKLIST-001 to CH-001, and the sequence is now
-- per zodu AND branch (it was per zodu), so the unique index follows suit.
--
--   * Existing codes keep their number: CHECKLIST-013 -> CH-013.
--   * uq_checklists_zodu_code (zodu_id, checklist_code) is replaced by
--     uq_checklists_zodu_branch_code (zodu_id, branch_id, checklist_code).
--     The new index is built first, so uniqueness is never unenforced.
--
-- Run this once against the checklist service's database.
-- Safe to re-run: the UPDATE matches nothing once renamed and the index
-- statements are IF [NOT] EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS uq_checklists_zodu_branch_code
    ON tbl_checklists (zodu_id, branch_id, checklist_code);

UPDATE tbl_checklists
SET checklist_code = REGEXP_REPLACE(checklist_code, '^CHECKLIST-', 'CH-')
WHERE checklist_code LIKE 'CHECKLIST-%';

DROP INDEX IF EXISTS uq_checklists_zodu_code;
