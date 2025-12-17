const taskRepo = require('../repositories/taskRepo');


const listByChecklistId = async (checklist_id) => taskRepo.listByChecklist(checklist_id);


module.exports = { listByChecklistId };