-- Seeds a default tbl_kot_settings row for every existing branch, matching
-- the app-level fallback in kot-repo.js's getSettings()/DEFAULT_SETTINGS —
-- so an existing tenant has a real row on disk instead of relying purely on
-- the runtime default the API happens to apply when none exists. A brand
-- new branch going forward still works fine without a row (getSettings()
-- still falls back), this is purely about existing branches having
-- something concrete to see/edit from and for any reporting that reads the
-- table directly.
--
-- restaurant-service has no local branches table (auth-service owns that);
-- every branch that has set up a menu or placed an order is a branch this
-- service already knows about, so the union of the two is the backfill set.
--
-- Run this once against the restaurant-service database. Safe to re-run:
-- ON CONFLICT DO NOTHING leaves any already-saved settings untouched.

INSERT INTO tbl_kot_settings
    (zodu_id, branch_id, kot_printing_enabled, default_counter_id, billing_printer_id,
     print_all_at_billing, billing_copy_mode, max_retries)
SELECT zodu_id, branch_id, TRUE, NULL, NULL, TRUE, 'consolidated', 1
FROM (
    SELECT DISTINCT zodu_id, branch_id FROM tbl_menu_items
    UNION
    SELECT DISTINCT zodu_id, branch_id FROM tbl_orders
) AS existing_branches
ON CONFLICT (zodu_id, branch_id) DO NOTHING;
