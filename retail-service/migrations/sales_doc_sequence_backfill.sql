-- Seeds tbl_doc_id_seq from existing tbl_sales rows so switching generateSaleId
-- to the shared counter table (see sales_doc_sequence_backfill's sibling code
-- change) doesn't restart numbering at 001 for a branch that already has
-- sales. Without this, the next INV/QUO/PRO created after that code ships
-- would regenerate an already-used sale_id and fail tbl_sales'
-- unique_sale_per_branch constraint (sale_id, branch_id) — invoice/quotation/
-- proforma IDs were already sequential in this exact "<prefix>-<branch>-NNN"
-- shape, unlike the old random customer_id, so this backfill is not optional.
--
-- Takes the highest existing trailing number per (zodu_id, branch_id, sale_type)
-- regardless of what prefix it was created under (prefixes can change over
-- time in Settings — see generateSaleId's own comment on this), and seeds
-- tbl_doc_id_seq so the NEXT generated id continues from there. Uses
-- GREATEST on conflict so re-running this after new sales have already been
-- created under the new scheme never moves the counter backwards.
--
-- Run this once against the retail_service database, AFTER
-- purchase_expense_id_sequence.sql (creates tbl_doc_id_seq) and BEFORE the
-- code that reads/writes doc_type INV/QUO/PRO ships to that environment.

INSERT INTO tbl_doc_id_seq (zodu_id, branch_id, doc_type, last_seq)
SELECT
    zodu_id,
    branch_id,
    CASE sale_type WHEN 'Q' THEN 'QUO' WHEN 'P' THEN 'PRO' ELSE 'INV' END AS doc_type,
    MAX((regexp_match(sale_id, '-(\d+)$'))[1]::int) AS last_seq
FROM tbl_sales
WHERE sale_id ~ '-(\d+)$'
GROUP BY zodu_id, branch_id, sale_type
ON CONFLICT (zodu_id, branch_id, doc_type) DO UPDATE
    SET last_seq = GREATEST(tbl_doc_id_seq.last_seq, EXCLUDED.last_seq);
