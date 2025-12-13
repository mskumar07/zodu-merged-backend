// src/services/checklistScheduleService.js
const scheduleRepo = require('../repositories/checklistScheduleRepo');
const checklistRepo = require('../repositories/checklistRepo');

const createSchedule = async (payload) => {
  // ensure parent exists
  const checklist = await checklistRepo.findById(payload.checklist_id);
  if (!checklist) {
    const e = new Error('Checklist not found');
    e.status = 404;
    throw e;
  }
  return scheduleRepo.create(payload);
};

const listByChecklist = async (checklist_id) => scheduleRepo.findByChecklistId(checklist_id);
const updateSchedule = async (id, patch) => scheduleRepo.update(id, patch);
const deleteSchedule = async (id) => scheduleRepo.remove(id);

module.exports = { createSchedule, listByChecklist, updateSchedule, deleteSchedule };
