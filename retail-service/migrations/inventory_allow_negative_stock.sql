-- Lets tbl_inventory.available_qty go below zero.
--
-- Stock Check (POS settings) is what decides whether a shortfall blocks a sale.
-- With it OFF the branch is saying "sell anyway", so createOrder deducts the
-- full quantity without checking (see retail-service/src/services/
-- retail-service.js, the `if (!isQuotation)` stock block). chk_stock_non_negative
-- contradicted that: the UPDATE was rejected and the whole sale failed with a
-- raw constraint error, so turning Stock Check off made selling harder, not
-- easier.
--
-- A negative quantity is the point here — it records how much was sold beyond
-- what stock said was on hand, instead of silently flattening the deficit to 0.
--
-- Safe to re-run: DROP CONSTRAINT IF EXISTS.
-- restaurant-service's own tbl_inventory never had this constraint, so nothing
-- to do there.

ALTER TABLE tbl_inventory
    DROP CONSTRAINT IF EXISTS chk_stock_non_negative;
