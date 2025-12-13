// src/services/checklistService.js
const checklistRepo = require('../repositories/checklistRepo');

const createChecklist = async (payload) => {
  // basic validation
  if (!payload.zodu_id || !payload.branch_id || !payload.name) {
    const err = new Error('Missing required fields');
    err.status = 400;
    throw err;
  }
  return checklistRepo.create(payload);
};

const getChecklist = async (id) => checklistRepo.findById(id);
const listChecklists = async (filter) => checklistRepo.list(filter);
const updateChecklist = async (id, patch) => checklistRepo.update(id, patch);
const deleteChecklist = async (id) => checklistRepo.remove(id);

module.exports = { createChecklist, getChecklist, listChecklists, updateChecklist, deleteChecklist };
