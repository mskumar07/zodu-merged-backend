-- invoice_prefix_enabled (see invoice_settings_prefix_enabled.sql) was added
-- with DEFAULT FALSE, which retroactively applied to every pre-existing
-- branch, not just new ones. Practical effect: every tenant that had never
-- touched this brand-new setting silently lost their Invoice/Sale/restaurant
-- order-number prefix the moment that migration ran (retail-service's
-- generateSaleId and restaurant-service's generatePublicOrderNo both gate on
-- this column). Flip the default to TRUE and backfill every row still at the
-- inherited FALSE back to TRUE, restoring prefixes for everyone; a business
-- can still explicitly opt out via the Settings screen going forward.
ALTER TABLE tbl_invoice_settings
  ALTER COLUMN invoice_prefix_enabled SET DEFAULT TRUE;

UPDATE tbl_invoice_settings
   SET invoice_prefix_enabled = TRUE
 WHERE invoice_prefix_enabled = FALSE;
