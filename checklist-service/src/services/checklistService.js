// src/services/checklistService.js
const checklistRepo = require('../repositories/checklistRepo');
const taskRepo = require('../repositories/taskRepo');
const scheduleRepo = require('../repositories/checklistScheduleRepo');
const assigneeRepo = require('../repositories/taskAssigneeRepo');
const checklistInstanceRepo = require('../repositories/checklistInstanceRepo');
const taskInstanceRepo = require('../repositories/taskInstanceRepo');
const db = require('../database/connection');

const createChecklist = async (payload) => {
  // basic validation
  if (!payload.zodu_id || !payload.branch_id || !payload.name) {
    const err = new Error('Missing required fields');
    err.status = 400;
    throw err;
  }
  return checklistRepo.create(payload);
};

const createChecklistWithDetails = async (payload) => {
  const { checklist, tasks = [], schedule, assignees = [] } = payload;

  // 🔐 Basic validation
  if (!checklist?.title || !checklist?.branch_id || !checklist?.zodu_id) {
    throw new Error("Missing required checklist fields");
  }

  try {
    // 1️⃣ create checklist
    const createdChecklist = await checklistRepo.createTx({
      name: checklist.title,
      description: checklist.description || null,
      category_id: checklist.category_id || null,
      branch_id: checklist.branch_id,
      zodu_id: checklist.zodu_id,
      created_by: checklist.created_by || null
    });

    // 2️⃣ create tasks
    const taskIds = [];

    for (const task of tasks) {
      if (!task.title) continue; // 🛑 guard
console.log("new",task)
      const createdTask = await taskRepo.create({
        checklist_id: createdChecklist.id,
        title: task.title,
        description: task.description || null,
        reference_image_url: JSON.stringify(task.reference_image_url) || null,
        voice_url: task.voice_note_url || null
      });

      if (createdTask?.id) {
        taskIds.push(createdTask.id);
      }
    }

    if (!taskIds.length) {
      throw new Error("Checklist must have at least one task");
    }

    // 3️⃣ create schedule
    let scheduledFor = new Date();

    if (schedule?.due_date) {
      scheduledFor =
        schedule.due_date && schedule.due_time
          ? new Date(`${schedule.due_date}T${schedule.due_time}:00Z`)
          : new Date(`${schedule.due_date}T00:00:00Z`);

      await scheduleRepo.create({
        checklist_id: createdChecklist.id,
        timezone: "UTC",
        start_date: schedule.due_date,
        due_at: schedule.due_time || null,
        recurrence_rrule: schedule.repeat
          ? `FREQ=${schedule.repeat.toUpperCase()}`
          : null,
        end_date: null,
        reminder_offsets: []
      });
    }

    // 4️⃣ assign users
    for (const userId of assignees) {
      if (!userId) continue; // 🛑 guard

      await assigneeRepo.assignTx({
        checklist_id: createdChecklist.id,
        user_id: userId
      });
    }

    // 5️⃣ create checklist instance
    const instance = await checklistInstanceRepo.create({
      checklist_id: createdChecklist.id,
      scheduled_for: scheduledFor,
      status: "pending"
    });

    // 6️⃣ create task instances (DEDUP SAFE)
    for (const taskId of taskIds) {
      if (!taskId) continue; // 🛑 guard

      const exists = await db.query(
        `
        SELECT 1
        FROM tbl_task_instance
        WHERE checklist_instance_id = $1
          AND task_id = $2
        `,
        [instance.id, taskId]
      );

      if (!exists.rows.length) {
        await taskInstanceRepo.createTx(instance.id, taskId.id);
      }
    }

    return {
      checklist_id: createdChecklist.id,
      checklist_instance_id: instance.id,
      message: "Checklist created successfully"
    };
  } catch (err) {
    throw err;
  }
};




const getChecklist = async (id) => checklistRepo.findById(id);
const listChecklists = async (filter) => checklistRepo.list(filter);

const updateChecklist = async (checklistId, payload) => {
  const { checklist = {}, tasks = [], schedule, assignees = [] } = payload;

  try {
    /* -------------------------------------------------
       1️⃣ UPDATE CHECKLIST CORE
    ------------------------------------------------- */
    if (Object.keys(checklist).length) {
      await checklistRepo.update(checklistId, {
        name: checklist.title,
        description: checklist.description || null,
        category_id: checklist.category_id || null
      });
    }

    /* -------------------------------------------------
       2️⃣ TASK DIFF
    ------------------------------------------------- */
    const existingTasks = await taskRepo.listByChecklist(checklistId);
    const existingTaskIds = existingTasks.map(t => t.id);
    const incomingTaskIds = tasks.filter(t => t.id).map(t => t.id);

    // ❌ removed tasks
    const removedTaskIds = existingTaskIds.filter(
      id => !incomingTaskIds.includes(id)
    );

    for (const taskId of removedTaskIds) {
      await taskRepo.remove(taskId);
      await taskInstanceRepo.removeByTaskId(taskId);
    }

    /* -------------------------------------------------
       3️⃣ GET LATEST CHECKLIST INSTANCE
    ------------------------------------------------- */
    const instance =
      await checklistInstanceRepo.getLatestByChecklist(checklistId);

    if (!instance) {
      throw new Error("Checklist instance not found");
    }

    /* -------------------------------------------------
       4️⃣ UPDATE / CREATE TASKS + INSTANCES
    ------------------------------------------------- */
    for (const task of tasks) {
      let taskId;

      // ✅ EXISTING TASK
      if (task.id) {
        taskId = task.id;

        await taskRepo.update(taskId, {
          title: task.title,
          description: task.description || null,
          reference_image_url: task.reference_image_url
            ? JSON.stringify(task.reference_image_url)
            : null,
          voice_url: task.voice_note_url || null
        });
      }

      // ➕ NEW TASK (NO ID)
      else {
        const createdTask = await taskRepo.create({
          checklist_id: checklistId,
          title: task.title,
          description: task.description || null,
          reference_image_url: task.reference_image_url
            ? JSON.stringify(task.reference_image_url)
            : null,
          voice_url: task.voice_note_url || null
        });

        taskId = createdTask.id;
      }

      // ✅ ENSURE TASK INSTANCE EXISTS
      const exists = await taskInstanceRepo.exists(
        instance.id,
        taskId
      );

      if (!exists) {
        console.log(instance)
        await taskInstanceRepo.createTx(
           instance.id,
           taskId
        );
      }
    }

    /* -------------------------------------------------
       5️⃣ SCHEDULE
    ------------------------------------------------- */
    if (schedule) {
      const existingSchedule =
        await scheduleRepo.findByChecklistId(checklistId);

      const patch = {
        start_date: schedule.due_date,
        due_at: schedule.due_time || null,
        recurrence_rrule: schedule.repeat
          ? `FREQ=${schedule.repeat.toUpperCase()}`
          : null
      };

      if (existingSchedule?.length) {
        await scheduleRepo.update(existingSchedule[0].id, patch);
      } else {
        await scheduleRepo.create({
          checklist_id: checklistId,
          timezone: "UTC",
          ...patch,
          end_date: null,
          reminder_offsets: []
        });
      }
    }

    /* -------------------------------------------------
       6️⃣ ASSIGNEES (REPLACE)
    ------------------------------------------------- */
    await assigneeRepo.removeByChecklist(checklistId);

    for (const userId of assignees) {
      await assigneeRepo.assignTx({
        checklist_id: checklistId,
        user_id: userId
      });
    }

    return {
      checklist_id: checklistId,
      message: "Checklist updated successfully"
    };
  } catch (err) {
    throw err;
  }
};


// const updateChecklist = async (checklistId, payload) => {
//   const { checklist = {}, tasks = [], schedule, assignees = [] } = payload;

//   console.log("mypayload",payload);

//   try {
//     /* -------------------------------------------------
//        1️⃣ UPDATE CHECKLIST CORE
//     ------------------------------------------------- */
//     if (Object.keys(checklist).length) {
//       await checklistRepo.update(checklistId, {
//         name: checklist.title,
//         description: checklist.description,
//         category_id: checklist.category_id
//       });
//     }

//     /* -------------------------------------------------
//        2️⃣ TASKS (DIFF BASED)
//     ------------------------------------------------- */
//     const existingTasks = await taskRepo.listByChecklist(checklistId);
//     const existingTaskIds = existingTasks.map(t => t.id);
//     const incomingTaskIds = tasks.filter(t => t.id).map(t => t.id);

//     // ❌ remove deleted tasks
//     const removedTaskIds = existingTaskIds.filter(
//       id => !incomingTaskIds.includes(id)
//     );

//     for (const taskId of removedTaskIds) {
//       await taskRepo.remove(taskId);
//       await taskInstanceRepo.removeByTaskId(taskId);
//     }

//     // ✅ update existing & ➕ add new
//     for (const task of tasks) {
//       if (task.id) {
//         await taskRepo.update(task.id, {
//           title: task.title,
//           description: task.description || null,
//           reference_image_url: JSON.stringify(task.reference_image_url),
//           voice_url: task.voice_note_url
//         });
//       } else {
//         const createdTask = await taskRepo.create({
//           checklist_id: checklistId,
//           title: task.title,
//           reference_image_url: JSON.stringify(task.reference_image_url) || null,
//           voice_url: task.voice_note_url || null
//         });

//         // attach to latest checklist instance
//         const instance = await checklistInstanceRepo.getLatestByChecklist(
//           checklistId
//         );

//         const exists = await taskInstanceRepo.exists(
//     instance.id,   // UUID
//     taskId         // UUID
//   );

//   if (!exists) {
//     await taskInstanceRepo.createTx({
//       checklist_instance_id: instance.id,
//       task_id: taskId
//     });
//   }

//         if (instance) {
//           await taskInstanceRepo.createTx(instance.id, createdTask.id);
//         }
//       }
//     }

//     /* -------------------------------------------------
//        3️⃣ SCHEDULE
//     ------------------------------------------------- */
//     if (schedule) {
//       const existingSchedule = await scheduleRepo.findByChecklistId(
//         checklistId
//       );

//       console.log("existingSchedule",existingSchedule)

//       const patch = {
//         start_date: schedule.due_date,
//         due_at: schedule.due_time || null,
//         recurrence_rrule: schedule.repeat
//           ? `FREQ=${schedule.repeat.toUpperCase()}`
//           : null
//       };

//       if (existingSchedule) {
//         await scheduleRepo.update(existingSchedule[0].id, patch);
//       } else {
//         await scheduleRepo.create({
//           checklist_id: checklistId,
//           timezone: "UTC",
//           ...patch,
//           end_date: null,
//           reminder_offsets: []
//         });
//       }
//     }

//     /* -------------------------------------------------
//        4️⃣ ASSIGNEES (REPLACE)
//     ------------------------------------------------- */
//     await assigneeRepo.removeByChecklist(checklistId);

//     for (const userId of assignees) {
//       await assigneeRepo.assignTx({
//         checklist_id: checklistId,
//         user_id: userId
//       });
//     }

//     return {
//       checklist_id: checklistId,
//       message: "Checklist updated successfully"
//     };

//   } catch (err) {
//     throw err;
//   }
// };
const getDashboardSummary = async (filter) => checklistRepo.getDashboardSummary(filter);
const deleteChecklist = async (id) => checklistRepo.remove(id);

module.exports = { createChecklist, getChecklist, listChecklists, updateChecklist, deleteChecklist,createChecklistWithDetails,getDashboardSummary};
