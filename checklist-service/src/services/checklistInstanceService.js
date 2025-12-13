// src/services/checklistInstanceService.js
const checklistInstanceRepo = require('../repositories/checklistInstanceRepo');
const checklistRepo = require('../repositories/checklistRepo');

const createChecklistInstance = async ({ checklist_id, scheduled_for, deadline = null }) => {
  // ensure checklist exists
  const checklist = await checklistRepo.findById(checklist_id);
  if (!checklist) {
    const e = new Error('Checklist not found');
    e.status = 404;
    throw e;
  }
  // create instance (trigger will clone tasks)
  const inst = await checklistInstanceRepo.create({ checklist_id, scheduled_for, deadline });
  return inst;
};

const getInstance = async (id) => checklistInstanceRepo.findById(id);

module.exports = { createChecklistInstance, getInstance };
