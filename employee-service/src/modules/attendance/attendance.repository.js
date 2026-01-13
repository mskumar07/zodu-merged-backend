const db = require('../../database/connection');

   class AttendanceRepository {
  async checkIn({ id, employee_id, department_id, branch_id, date }) {
    return db.query(
      `INSERT INTO tbl_attendance (
        attendance_id, employee_id, department_id, branch_id, 
        attendance_date, check_in, status
      ) VALUES ($1,$2,$3,$4,$5,NOW(),'Present')`,
      [id, employee_id, department_id, branch_id, date]
    );
  }

  async checkOut(employeeId, date) {
    return db.query(
      `UPDATE tbl_attendance
       SET check_out = NOW(),
           total_hours = EXTRACT(EPOCH FROM (NOW() - check_in))/3600
       WHERE employee_id = $1 
       AND attendance_date = $2 
       AND check_out IS NULL
       RETURNING *`,
      [employeeId, date]
    );
  }

async getAttendanceHistory(employeeId, limit = 10, offset = 0, month = null, status = "all") {

  // Convert selected month (YYYY-MM) to YYYY-MM-01
  const monthStart = month ? `${month}-01` : null;

  const monthFilter = month
    ? `AND DATE_TRUNC('month', attendance_date) = DATE_TRUNC('month', TO_DATE($4, 'YYYY-MM-DD'))`
    : "";

  // ----------------------------------------
  // 🔥 MONTHLY SUMMARY
  // ----------------------------------------
  const monthlySummarySql = `
    SELECT 
      -- Present count this month
      (
        SELECT COUNT(*)
        FROM tbl_attendance
        WHERE employee_id = $1
        AND DATE_TRUNC('month', attendance_date) = DATE_TRUNC('month', CURRENT_DATE)
      ) AS total_present_this_month,

      -- Absent = days passed - present
      (
        SELECT EXTRACT(DAY FROM CURRENT_DATE)
      ) 
      -
      (
        SELECT COUNT(*)
        FROM tbl_attendance
        WHERE employee_id = $1
        AND DATE_TRUNC('month', attendance_date) = DATE_TRUNC('month', CURRENT_DATE)
      ) AS total_absent_this_month
  `;

  const summary = await db.query(monthlySummarySql, [employeeId]);

  // ----------------------------------------
  // 🔥 STATUS FILTER
  // ----------------------------------------
  let statusCondition = "";

  if (status === "present") {
    statusCondition = "AND check_in IS NOT NULL";
  } else if (status === "absent") {
    statusCondition = "AND check_in IS NULL";
  } else if (status === "leave") {
    statusCondition = `
      AND attendance_date BETWEEN 
        (SELECT start_date FROM tbl_leaves WHERE employee_id = $1 LIMIT 1)
        AND
        (SELECT end_date FROM tbl_leaves WHERE employee_id = $1 LIMIT 1)
    `;
  }

  // ----------------------------------------
  // 🔥 MAIN ATTENDANCE LIST
  // ----------------------------------------
  const sql = `
    SELECT 
      attendance_id,
      TO_CHAR(attendance_date, 'Mon DD, YYYY') AS date,
      TO_CHAR(check_in, 'HH:MI AM') AS check_in,
      TO_CHAR(check_out, 'HH:MI AM') AS check_out,
      CASE
        WHEN check_in IS NOT NULL THEN 'Present'
        ELSE 'Absent'
      END AS status
    FROM tbl_attendance
    WHERE employee_id = $1
      ${monthFilter}
      ${statusCondition}
    ORDER BY attendance_date DESC
    LIMIT $2 OFFSET $3
  `;

  const params = month
    ? [employeeId, limit, offset, monthStart]
    : [employeeId, limit, offset];

  const records = await db.query(sql, params);

  // ----------------------------------------
  // 🔥 TODAY'S CHECK-IN DETAILS
  // ----------------------------------------
  const todaySql = `
    SELECT 
      TO_CHAR(attendance_date, 'Mon DD, YYYY') AS date,
      TO_CHAR(check_in, 'HH:MI AM') AS check_in,
      TO_CHAR(check_out, 'HH:MI AM') AS check_out,
      CASE
        WHEN check_in IS NOT NULL THEN 'Present'
        ELSE 'Absent'
      END AS status
    FROM tbl_attendance
    WHERE employee_id = $1
    AND attendance_date = CURRENT_DATE
    LIMIT 1
  `;

  const todayResult = await db.query(todaySql, [employeeId]);
  const today = todayResult.rows[0] || {
    date: null,
    check_in: "--",
    check_out: "--",
    status: "Absent",
  };

  // ----------------------------------------
  // 🔥 FINAL RESPONSE
  // ----------------------------------------
  return {
    summary: summary.rows[0],
    today: today,
    records: records.rows,
  };
}




  async getTeamStats(branch) {
    return db.query(
      `SELECT 
        (SELECT COUNT(*) FROM tbl_employees WHERE branch_id = $1) AS total_employees,
        (SELECT COUNT(*) FROM tbl_attendance WHERE attendance_date = CURRENT_DATE AND branch_id = $1) AS today_present,
        (SELECT COUNT(*) FROM tbl_leaves WHERE CURRENT_DATE BETWEEN start_date AND end_date AND branch_id = $1) AS on_leave`,
      [branch]
    );
  }

  async getTeamEmployeeList(branch, date = 'CURRENT_DATE') {
    const dateQuery = date === 'CURRENT_DATE' ? 'CURRENT_DATE' : `'${date}'`;

    return db.query(
      `SELECT 
          e.employee_id,
          e.name,
          e.role,
          COALESCE(a.status, 'Absent') AS status,
          TO_CHAR(a.check_in, 'HH:MI AM') AS check_in,
          TO_CHAR(a.check_out, 'HH:MI AM') AS check_out
        FROM tbl_employees e
        LEFT JOIN tbl_attendance a 
        ON a.employee_id = e.employee_id 
        AND a.attendance_date = ${dateQuery}
        WHERE e.branch_id = $1
        ORDER BY e.name`, 
      [branch]
    );
  }


 // attendance.repository.js

async requestLeave({ leave_id, employee_id, zodu_id, branch_id, leave_type, start_date, end_date, reason }) {
  const sql = `
    INSERT INTO tbl_leaves (
      leave_id, employee_id, zodu_id, branch_id, leave_type, start_date, end_date, reason, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
    RETURNING *
  `;
  
  // ✅ Pass zodu_id and branch_id in the params array
  const result = await db.query(sql, [
    leave_id, employee_id, zodu_id, branch_id, leave_type, start_date, end_date, reason
  ]);
  
  return result.rows[0];
}

  async approveLeave(leaveId, managerId, status) {
    const sql = `
      UPDATE tbl_leaves 
      SET status = $1, approved_by = $2, updated_at = NOW()
      WHERE leave_id = $3
      RETURNING *
    `;
    const result = await db.query(sql, [status, managerId, leaveId]);
    return result.rows[0];
  }

  async getLeaveHistory(employeeId, limit, offset) {
    const sql = `
      SELECT 
        leave_id,
        leave_type,
        TO_CHAR(start_date, 'Mon DD') || ' - ' || TO_CHAR(end_date, 'Mon DD') as date_range,
        status,
        (end_date - start_date) + 1 as duration_days,
        TO_CHAR(created_at, 'Mon DD, YYYY') as applied_on,
        reason
      FROM tbl_leaves
      WHERE employee_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    return db.query(sql, [employeeId, limit, offset]);
  }

  async getPendingLeaves(branchId) {
    const sql = `
      SELECT 
        l.leave_id,
        e.name,
        e.role,
        l.leave_type,
        TO_CHAR(l.start_date, 'Mon DD') || ' - ' || TO_CHAR(l.end_date, 'Mon DD') as date,
        (l.end_date - l.start_date) + 1 || ' Days' as duration,
        l.reason,
        l.status
      FROM tbl_leaves l
      JOIN tbl_employees e ON l.employee_id = e.employee_id
      WHERE e.branch_id = $1 AND l.status = 'Pending'
      ORDER BY l.created_at DESC
    `;
    const result = await db.query(sql, [branchId]);
    return result.rows;
  }
async getBranchLeaveRequests({ branch_id, status, limit = 10, offset = 0 }) {
    
    // Optional Filter: If status is 'all' or undefined, fetch everything.
    // Otherwise, filter by specific status (Pending, Approved, Rejected)
    const statusFilter = (status && status !== 'all') 
      ? `AND l.status = '${status}'` 
      : "";

    const sql = `
      SELECT 
        l.leave_id,
        e.employee_id,
        e.name,
        e.role,
        e.zodu_id,
        l.leave_type,
        TO_CHAR(l.start_date, 'Mon DD, YYYY') as start_date_fmt,
        TO_CHAR(l.end_date, 'Mon DD, YYYY') as end_date_fmt,
        (l.end_date - l.start_date) + 1 as duration_days,
        l.reason,
        l.status,
        TO_CHAR(l.created_at, 'Mon DD, YYYY HH:MI AM') as applied_on
      FROM tbl_leaves l
      JOIN tbl_employees e ON l.employee_id = e.employee_id
      WHERE e.branch_id = $1
      ${statusFilter}
      ORDER BY 
        CASE WHEN l.status = 'Pending' THEN 1 ELSE 2 END, -- Show Pending first
        l.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await db.query(sql, [branch_id, limit, offset]);
    return result.rows;
  }
  // Add this inside the AttendanceRepository class

async getTodayAttendance(employeeId) {
  const sql = `
    SELECT 
      attendance_id,
      TO_CHAR(check_in, 'HH:MI AM') AS check_in,
      TO_CHAR(check_out, 'HH:MI AM') AS check_out,
      CASE 
        WHEN check_in IS NOT NULL AND check_out IS NULL THEN true 
        ELSE false 
      END AS is_currently_active,
      CASE 
        WHEN check_in IS NOT NULL THEN true 
        ELSE false 
      END AS has_checked_in,
      CASE 
        WHEN check_out IS NOT NULL THEN true 
        ELSE false 
      END AS has_checked_out
    FROM tbl_attendance
    WHERE employee_id = $1 
    AND attendance_date = CURRENT_DATE
    LIMIT 1
  `;

  try {
    const result = await db.query(sql, [employeeId]);
    
    // Check if result exists and has rows
    if (!result || !result.rows || result.rows.length === 0) {
      return {
        has_checked_in: false,
        has_checked_out: false,
        is_currently_active: false,
        check_in: "--",
        check_out: "--"
      };
    }

    return result.rows[0];
  } catch (err) {
    console.error("Database Error:", err);
    throw err; // Pass error up to controller
  }
}

}
module.exports = new AttendanceRepository();