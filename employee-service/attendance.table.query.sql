-- ─────────────────────────────────────────────────────────────────────────────
-- ATTENDANCE  —  attendance.table.query.sql
-- Run in: employee-service database (co-located with tbl_employees — attendance
-- always joins against employees, so keeping it in the same service/DB avoids
-- cross-service joins over the network)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. DAILY ATTENDANCE  (one row per employee per calendar date)
-- Matches the "Mark Attendance" modal — a single check-in/check-out pair
-- and one status per employee per day.
CREATE TABLE tbl_attendance (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    zodu_id          VARCHAR(50)  NOT NULL,
    branch_id        VARCHAR(50)  NOT NULL,
    employee_id      UUID         NOT NULL REFERENCES tbl_employees(employee_id) ON DELETE CASCADE,
    attendance_date  DATE         NOT NULL,
    status           VARCHAR(20)  NOT NULL DEFAULT 'Present',
    -- values: 'Present', 'Absent', 'Weekly Off'
    check_in_time    TIMESTAMPTZ,
    check_out_time   TIMESTAMPTZ,
    remarks          TEXT,
    marked_by        UUID         NOT NULL,
    -- manager/admin who saved this row via "Mark Attendance"
    marked_by_name   VARCHAR(100) NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attendance_employee_date UNIQUE (employee_id, attendance_date)
);

CREATE INDEX idx_attendance_zodu_branch_date ON tbl_attendance(zodu_id, branch_id, attendance_date);
-- ^ primary lookup for "Team Attendance — <Month> <Year>" grid (branch + month/year scan)
CREATE INDEX idx_attendance_employee_date    ON tbl_attendance(employee_id, attendance_date);
-- ^ primary lookup for "My Attendance" personal month/year view
CREATE INDEX idx_attendance_status           ON tbl_attendance(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- MONTH/YEAR FILTER — always scope by:
--   attendance_date >= DATE_TRUNC('month', MAKE_DATE($year, $month, 1))
--   AND attendance_date <  DATE_TRUNC('month', MAKE_DATE($year, $month, 1)) + INTERVAL '1 month'
-- (range predicate so idx_attendance_zodu_branch_date / idx_attendance_employee_date
-- can be used as a proper index range scan)
-- ─────────────────────────────────────────────────────────────────────────────
