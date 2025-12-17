// src/services/checklistCategoryService.js
const repo = require('../repositories/taskAssigneeRepo');



const listAssignees = async (filter) => repo.listAssignees(filter);

module.exports = { listAssignees };