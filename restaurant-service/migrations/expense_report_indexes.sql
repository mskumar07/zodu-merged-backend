-- Covering index for expense reports (date-wise, category-wise, summaries).
-- Equality on tenant columns, range on expense_date; INCLUDE columns allow
-- index-only scans for the aggregate queries.
-- NOTE: CONCURRENTLY cannot run inside a transaction block — run as-is in psql/DBeaver (auto-commit).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tbl_expense_report
    ON tbl_expense (zodu_id, branch_id, expense_date)
    INCLUDE (category_id, total_amount, paid_amount);

-- Supports the category join / type filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tbl_category_scope_type
    ON tbl_category (zodu_id, branch_id, type);
