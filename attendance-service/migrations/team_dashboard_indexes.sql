-- Team dashboard (GET /api/attendance/dashboard/team): indexes that keep it a few index scans however many
-- managers have it open. Idempotent: safe to re-run.
--
--   idx_attendance_branch_date_cover  the trend and the day's counts read only (date, employee, status):
--                                     with those in the index they are index-only scans, no table reads.
--   idx_employees_branch_active       the team (active employees of a branch), already in name order for the
--                                     paged log. A partial index: inactive employees are left out.
--   idx_leave_requests_pending        the approval list: only Pending rows are indexed, a handful per branch.

CREATE INDEX IF NOT EXISTS idx_attendance_branch_date_cover
    ON tbl_attendance (zodu_id, branch_id, attendance_date) INCLUDE (employee_id, status);

CREATE INDEX IF NOT EXISTS idx_employees_branch_active
    ON tbl_employees (zodu_id, branch_id, name, employee_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_leave_requests_pending
    ON tbl_leave_requests (zodu_id, branch_id, from_date, applied_at) WHERE status = 'Pending';
