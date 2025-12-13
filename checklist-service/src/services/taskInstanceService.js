// src/services/taskInstanceService.js
const taskInstanceRepo = require('../repositories/taskInstanceRepo');

const completeTask = async (taskInstanceId, { completed_by = null } = {}) => {
  const updated = await taskInstanceRepo.complete(taskInstanceId, completed_by);
  if (!updated) {
    const e = new Error('Task instance not found');
    e.status = 404;
    throw e;
  }
  // the DB trigger will auto-complete checklist if all tasks done
  return updated;
};

const listTasksByInstance = async (checklist_instance_id) => taskInstanceRepo.listByChecklistInstance(checklist_instance_id);
const getTaskInstance = async (id) => taskInstanceRepo.findById(id);

module.exports = { completeTask, listTasksByInstance, getTaskInstance };
