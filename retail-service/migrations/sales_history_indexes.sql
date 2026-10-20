-- Sales History list: invoices and returns are merged and paginated in one query,
-- each half ordered by its own date + time (see getSalesHistory in retail-repo.js).
-- Equality on the tenant columns, then the sort keys, so each half reads only the
-- newest rows it needs instead of sorting a branch's whole history on every page.
-- NOTE: CONCURRENTLY cannot run inside a transaction block — run as-is in psql/DBeaver (auto-commit).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tbl_sales_history_order
    ON tbl_sales (zodu_id, branch_id, sale_date DESC, sale_time DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tbl_sale_returns_history_order
    ON tbl_sale_returns (zodu_id, branch_id, return_date DESC, return_time DESC);
