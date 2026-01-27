// src/repositories/taskRepo.js
const db = require('../database/connection');

const create = async ({ checklist_id, title, description, reference_image_url = null, voice_url = null }) => {
  const q = `
    INSERT INTO tbl_task (checklist_id, title, description, reference_image_url, voice_url)
    VALUES ($1,$2,$3,$4,$5) RETURNING *;
  `;
  const res = await db.query(q, [checklist_id, title, description, reference_image_url, voice_url]);
  return res.rows[0];
};

const listByChecklist = async (checklist_id) => {
  const res = await db.query(
    `
    WITH task_notes_agg AS (
      SELECT
        tn.task_id,
        jsonb_agg(
          jsonb_build_object(
            'id', tn.id,
            'note', tn.note,

            -- ✅ only user name
            'created_by', u.name,

            'created_at', tn.created_at
          )
          ORDER BY tn.created_at DESC
        ) AS notes
      FROM tbl_task_notes tn
      LEFT JOIN tbl_users u
        ON u.id = tn.created_by
      GROUP BY tn.task_id
    )

    SELECT
      t.*,

      -- ✅ task instances
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', ti.id,
            'custom_id', ti.custom_id,
            'checklist_instance_id', ti.checklist_instance_id,
            'task_id', ti.task_id,
            'status', ti.status,
            'completed_at', ti.completed_at,
            'created_at', ti.created_at
          )
        ) FILTER (WHERE ti.id IS NOT NULL),
        '[]'::jsonb
      ) AS instances,

      -- ✅ task notes (with created_by name)
      COALESCE(tna.notes, '[]'::jsonb) AS notes

    FROM tbl_task t
    LEFT JOIN tbl_task_instance ti
      ON ti.task_id = t.id
    LEFT JOIN task_notes_agg tna
      ON tna.task_id = t.id

    WHERE t.checklist_id = $1
    GROUP BY t.id, tna.notes
    ORDER BY t.created_at;
    `,
    [checklist_id]
  );

  return res.rows;
};





const findById = async (id) => {
  const res = await db.query('SELECT * FROM tbl_task WHERE id = $1', [id]);
  return res.rows[0];
};

const update = async (id, patch) => {
  console.log("data i get",id,patch)
  // Remove undefined & null values
  const filteredPatch = Object.fromEntries(
    Object.entries(patch).filter(
      ([_, v]) => v !== undefined && v !== null
    )
  );

  const keys = Object.keys(filteredPatch);
  if (!keys.length) return findById(id);

  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const vals = keys.map(k => filteredPatch[k]);
  vals.push(id);

  const q = `
    UPDATE tbl_task
    SET ${sets.join(', ')}
    WHERE id = $${keys.length + 1}
    RETURNING *
  `;

  const res = await db.query(q, vals);
  return res.rows[0];
};


const remove = async (id) => {
  console.log("fromtaskrepo",id)
  await db.query('DELETE FROM tbl_task WHERE id = $1', [id]);
  return true;
};

module.exports = { create, listByChecklist, findById, update, remove };
