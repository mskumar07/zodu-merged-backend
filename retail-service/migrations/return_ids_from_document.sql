-- Return / note numbers now come from the document they are against
-- (RET/<invoice or purchase id>, CN/<invoice id>, DN/<purchase id>, then -2, -3 ...;
-- utils/generateId.js), so:
--   * return_id needs room for the prefix and suffix on top of a 50-character
--     sale_id / purchase_id;
--   * sale return numbers must be unique per company + branch: two companies
--     can both have invoice INV-B1-0001 in their branch B1 (the old index was
--     per branch only, harmless while the numbers were random).
-- Existing returns keep their old RET-... / PRT-... numbers. Idempotent.

ALTER TABLE tbl_sale_returns     ALTER COLUMN return_id TYPE VARCHAR(80);
ALTER TABLE tbl_purchase_returns ALTER COLUMN return_id TYPE VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_return_id
    ON tbl_sale_returns (zodu_id, branch_id, return_id);
DROP INDEX IF EXISTS uq_return_id_branch;
