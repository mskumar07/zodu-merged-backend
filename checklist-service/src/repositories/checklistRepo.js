// src/repositories/checklistRepo.js
const db = require('../database/connection');
const { get } = require('../routes');

const create = async ({ zodu_id, branch_id, name, description, category_id, created_by }) => {
  const q = `
    INSERT INTO tbl_checklist (zodu_id, branch_id, name, description, category_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *;
  `;
  const res = await db.query(q, [zodu_id, branch_id, name, description, category_id, created_by]);
  return res.rows[0];
};

const findById = async (id) => {
  const res = await db.query('SELECT * FROM tbl_checklist WHERE id = $1', [id]);
  return res.rows[0];
};

// const list = async ({
//   zodu_id,
//   branch_id,
//   user_id,
//   role, // 'employee' | 'supervisor'
//   limit = 50,
//   offset = 0
// } = {}) => {

//   const q = `
//     WITH task_agg AS (
//       SELECT
//         t.checklist_id,
//         json_agg(
//           jsonb_build_object(
//             'id', t.id,
//             'title', t.title
//           )
//         ) AS tasks
//       FROM tbl_task t
//       GROUP BY t.checklist_id
//     ),

//     assignee_agg AS (
//       SELECT
//         ca.checklist_id,
//         json_agg(
//           jsonb_build_object(
//             'user_id', u.id,
//             'name', u.name
//           )
//         ) AS assignees
//       FROM tbl_checklist_assignees ca
//       JOIN tbl_users u ON u.id = ca.user_id
//       GROUP BY ca.checklist_id
//     ),

//     task_stats AS (
//       SELECT
//         ci.checklist_id,

//         COUNT(ti.id) FILTER (
//           WHERE ($4 = 'supervisor' OR ti.assigned_user_id = $3)
//         ) AS total_tasks,

//         COUNT(ti.id) FILTER (
//           WHERE ti.status = 'completed'
//             AND ($4 = 'supervisor' OR ti.assigned_user_id = $3)
//         ) AS completed_tasks,

//         COUNT(ti.id) FILTER (
//           WHERE ti.status = 'pending'
//             AND ($4 = 'supervisor' OR ti.assigned_user_id = $3)
//         ) AS pending_tasks

//       FROM tbl_checklist_instance ci
//       JOIN tbl_task_instance ti
//         ON ti.checklist_instance_id = ci.id
//       GROUP BY ci.checklist_id
//     )

//     SELECT
//       c.id,
//       c.name,
//       c.zodu_id,
//       c.branch_id,
//       c.created_at,

//       -- tasks (template level, visible to all)
//       COALESCE(ta.tasks, '[]') AS tasks,

//       -- schedule
//       jsonb_build_object(
//         'start_date', s.start_date,
//         'end_date', s.end_date,
//         'due_at', s.due_at,
//         'timezone', s.timezone,
//         'recurrence_rrule', s.recurrence_rrule,
//         'reminder_offsets', s.reminder_offsets
//       ) AS schedule,

//       -- assignees (always full list)
//       COALESCE(aa.assignees, '[]') AS assignees,

//       -- task stats (role aware)
//       COALESCE(ts.total_tasks, 0) AS total_tasks,
//       COALESCE(ts.completed_tasks, 0) AS completed_tasks,
//       COALESCE(ts.pending_tasks, 0) AS pending_tasks

//     FROM tbl_checklist c

//     LEFT JOIN task_agg ta
//       ON ta.checklist_id = c.id

//     LEFT JOIN tbl_checklist_schedule s
//       ON s.checklist_id = c.id

//     LEFT JOIN assignee_agg aa
//       ON aa.checklist_id = c.id

//     LEFT JOIN task_stats ts
//       ON ts.checklist_id = c.id

//     WHERE ($1::text IS NULL OR c.zodu_id = $1)
//       AND ($2::text IS NULL OR c.branch_id = $2)

//     ORDER BY c.created_at DESC
//     LIMIT $5 OFFSET $6;
//   `;

//   const res = await db.query(q, [
//     zodu_id || null,
//     branch_id || null,
//     user_id || null,
//     role,
//     limit,
//     offset
//   ]);

//   return res.rows;
// };

const list = async ({
  zodu_id,
  branch_id,
  user_id,
  limit = 50,
  offset = 0
} = {}) => {

  const q = `
 WITH task_notes_agg AS (
  SELECT
    tn.task_id,
    json_agg(
      jsonb_build_object(
        'id', tn.id,
        'note', tn.note,
        'created_by', tn.created_by,
        'created_at', tn.created_at
      )
      ORDER BY tn.created_at ASC
    ) AS notes
  FROM tbl_task_notes tn
  GROUP BY tn.task_id
),
   task_agg AS (
  SELECT
    t.checklist_id,
    json_agg(
      jsonb_build_object(
        'id', t.id,
        'custom_id', t.custom_id,
        'title', t.title,
        'description', t.description,
        'reference_image_url', t.reference_image_url,
        'voice_url', t.voice_url,

        -- ✅ task execution status
        'status', COALESCE(ti.status, 'pending'),
        'notes', COALESCE(tna.notes, '[]'::json)
      )
      ORDER BY t.created_at ASC
    ) AS tasks
  FROM tbl_task t
  LEFT JOIN tbl_task_instance ti
    ON ti.task_id = t.id
 LEFT JOIN task_notes_agg tna
    ON tna.task_id = t.id
  GROUP BY t.checklist_id
),

assignee_agg AS (
  SELECT
    ca.checklist_id,
    json_agg(
      jsonb_build_object(
        'user_id', u.id,
        'name', u.name
      )
    ) AS assignees
  FROM tbl_checklist_assignees ca
  JOIN tbl_users u ON u.id = ca.user_id
  GROUP BY ca.checklist_id
),

task_stats AS (
  SELECT
    ci.checklist_id,

    COUNT(DISTINCT ti.id) AS total_tasks,

    COUNT(DISTINCT ti.id)
      FILTER (WHERE ti.status = 'completed')
      AS completed_tasks,

    COUNT(DISTINCT ti.id)
      FILTER (WHERE ti.status = 'pending')
      AS pending_tasks,

    COUNT(DISTINCT ti.id)
      FILTER (
        WHERE ti.status = 'pending'
          AND ci.scheduled_for < now()
      ) AS overdue_tasks

  FROM tbl_checklist_instance ci
  JOIN tbl_task_instance ti
    ON ti.checklist_instance_id = ci.id
  LEFT JOIN tbl_checklist_assignees ca
    ON ca.checklist_id = ci.checklist_id

  WHERE ($3::uuid IS NULL OR ca.user_id = $3)
  GROUP BY ci.checklist_id
),

overall_stats AS (
  SELECT
    COUNT(DISTINCT ti.id) AS total_tasks,

    COUNT(DISTINCT ti.id)
      FILTER (WHERE ti.status = 'completed')
      AS completed_tasks,

    COUNT(DISTINCT ti.id)
      FILTER (WHERE ti.status = 'pending')
      AS pending_tasks,

    COUNT(DISTINCT ti.id)
      FILTER (
        WHERE ti.status = 'pending'
          AND ci.scheduled_for < now()
      ) AS overdue_tasks

  FROM tbl_task_instance ti
  JOIN tbl_checklist_instance ci
    ON ci.id = ti.checklist_instance_id
  JOIN tbl_checklist c
    ON c.id = ci.checklist_id
  LEFT JOIN tbl_checklist_assignees ca
    ON ca.checklist_id = c.id

  WHERE ($1::text IS NULL OR c.zodu_id = $1)
    AND ($2::text IS NULL OR c.branch_id = $2)
    AND ($3::uuid IS NULL OR ca.user_id = $3)
)

SELECT
  jsonb_build_object(
    'overall', (SELECT row_to_json(overall_stats) FROM overall_stats),
    'checklists', json_agg(
      jsonb_build_object(
        'id', c.id,

        'custom_id', c.custom_id,
        'name', c.name,
        'description', c.description,
        -- ✅ category (only id & name)
        'category_id', cc.id ,
        'category_name', cc.name ,

        'zodu_id', c.zodu_id,
        'branch_id', c.branch_id,
        'created_at', c.created_at,

        -- tasks with execution status
        'tasks', COALESCE(ta.tasks, '[]'),

        -- schedule definition
        'schedule', jsonb_build_object(
          'start_date', s.start_date,
          'end_date', s.end_date,
          'due_at', s.due_at,
          'timezone', s.timezone,
          'recurrence_rrule', s.recurrence_rrule,
          'reminder_offsets', s.reminder_offsets
        ),

        -- actual due instance
        'due', jsonb_build_object(
          'scheduled_for', ci.scheduled_for,
          'status', ci.status
        ),

        'assignees', COALESCE(aa.assignees, '[]'),

        'total_tasks', COALESCE(ts.total_tasks, 0),
        'completed_tasks', COALESCE(ts.completed_tasks, 0),
        'pending_tasks', COALESCE(ts.pending_tasks, 0),
        'overdue_tasks', COALESCE(ts.overdue_tasks, 0)
      )
      ORDER BY c.created_at DESC
    )
  ) AS result

FROM tbl_checklist c
LEFT JOIN tbl_checklist_category cc
  ON cc.id = c.category_id
LEFT JOIN task_agg ta
  ON ta.checklist_id = c.id
LEFT JOIN tbl_checklist_schedule s
  ON s.checklist_id = c.id
LEFT JOIN tbl_checklist_instance ci
  ON ci.checklist_id = c.id
LEFT JOIN assignee_agg aa
  ON aa.checklist_id = c.id
LEFT JOIN task_stats ts
  ON ts.checklist_id = c.id

WHERE ($1::text IS NULL OR c.zodu_id = $1)
  AND ($2::text IS NULL OR c.branch_id = $2)
  AND (
    $3::uuid IS NULL
    OR EXISTS (
      SELECT 1
      FROM tbl_checklist_assignees ca2
      WHERE ca2.checklist_id = c.id
        AND ca2.user_id = $3
    )
  )

LIMIT $4 OFFSET $5;


  `;

  const res = await db.query(q, [
    zodu_id || null,
    branch_id || null,
    user_id || null,
    limit,
    offset
  ]);

 return res.rows.length
  ? res.rows[0].result
  : {
      overall: {
        total_tasks: 0,
        completed_tasks: 0,
        pending_tasks: 0,
        overdue_tasks: 0
      },
      checklists: []
    };
};



const getDashboardSummary = async ({
  zodu_id,
  branch_id,
  user_id
} = {}) => {

  const q = `
    SELECT
      COUNT(DISTINCT ti.id) AS total_tasks,

      COUNT(DISTINCT ti.id)
        FILTER (WHERE ti.status = 'completed')
        AS completed_tasks,

      COUNT(DISTINCT ti.id)
        FILTER (WHERE ti.status = 'pending')
        AS pending_tasks,

      COUNT(DISTINCT ti.id)
        FILTER (
          WHERE ti.status = 'pending'
            AND ci.scheduled_for < now()
        ) AS overdue_tasks

    FROM tbl_task_instance ti
    JOIN tbl_checklist_instance ci
      ON ci.id = ti.checklist_instance_id
    JOIN tbl_checklist c
      ON c.id = ci.checklist_id

    WHERE ($1::text IS NULL OR c.zodu_id = $1)
      AND ($2::text IS NULL OR c.branch_id = $2)
      AND (
        $3::uuid IS NULL
        OR EXISTS (
          SELECT 1
          FROM tbl_checklist_assignees ca
          WHERE ca.checklist_id = c.id
            AND ca.user_id = $3
        )
      );
  `;

  const res = await db.query(q, [
    zodu_id || null,
    branch_id || null,
    user_id || null
  ]);

  return res.rows[0];
};





const update = async (id, patch) => {
  console.log("mumu",id,patch)
  const keys = Object.keys(patch);
  if (!keys.length) return findById(id);

  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const vals = keys.map(k => patch[k]);
  vals.push(id);

  const q = `UPDATE tbl_checklist SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`;
  const res = await db.query(q, vals);
  return res.rows[0];
};

const remove = async (id) => {
  await db.query('DELETE FROM tbl_checklist WHERE id = $1', [id]);
  return true;
};

const createTx = async (data) => {

    console.log(data)
  const res = await db.query(
    `
    INSERT INTO tbl_checklist (name, description, category_id, branch_id,zodu_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
    `,
    [
      data.name,
      data.description,
      data.category_id,
      data.branch_id,
      data.zodu_id,
      data.created_by,
    ]
  );
  return res.rows[0];
};


module.exports = { create, findById, list, update, remove,createTx,getDashboardSummary };
