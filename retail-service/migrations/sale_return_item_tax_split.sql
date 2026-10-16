-- Tax split on sale return items, so a return / credit note can show the same
-- breakdown as the invoice (taxable value, CGST, SGST) without recomputing it.
--
--   taxable_amount  -- line value before tax
--   cgst, sgst      -- tax_amount split in two; sgst = tax_amount - cgst, so the
--                      two always add up to tax_amount exactly
--
-- Stored per item (a snapshot) so the document does not change if the original
-- invoice is edited later. Existing rows are backfilled from the original sale
-- line (tax_inclusive decides whether the price already contains the tax).
-- Safe to re-run.

ALTER TABLE tbl_sale_return_items
    ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(18,2),
    ADD COLUMN IF NOT EXISTS cgst           NUMERIC(18,2),
    ADD COLUMN IF NOT EXISTS sgst           NUMERIC(18,2);

UPDATE tbl_sale_return_items ri
SET cgst           = ROUND(COALESCE(ri.tax_amount, 0) / 2, 2),
    sgst           = ROUND(COALESCE(ri.tax_amount, 0), 2) - ROUND(COALESCE(ri.tax_amount, 0) / 2, 2),
    taxable_amount = ROUND(
                       ri.return_qty * ri.price
                       - CASE WHEN COALESCE(si.tax_inclusive, TRUE) THEN COALESCE(ri.tax_amount, 0) ELSE 0 END,
                     2)
FROM tbl_sale_return_items r2
LEFT JOIN tbl_sale_items si ON si.id = r2.original_item_id
WHERE r2.id = ri.id
  AND ri.taxable_amount IS NULL;

ALTER TABLE tbl_sale_return_items
    ALTER COLUMN taxable_amount SET DEFAULT 0,
    ALTER COLUMN cgst           SET DEFAULT 0,
    ALTER COLUMN sgst           SET DEFAULT 0,
    ALTER COLUMN taxable_amount SET NOT NULL,
    ALTER COLUMN cgst           SET NOT NULL,
    ALTER COLUMN sgst           SET NOT NULL;
