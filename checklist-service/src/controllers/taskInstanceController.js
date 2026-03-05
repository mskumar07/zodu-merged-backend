// src/controllers/taskInstanceController.js
const taskInstanceService = require('../services/taskInstanceService');

const complete = async (req, res, next) => {
  try {
    console.log("complete",req.body)
    const updated = await taskInstanceService.completeTask(req.params.id, { completed_by: req.body.completed_by,status: req.body.status || null });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

const listByInstance = async (req, res, next) => {
  try {
    const rows = await taskInstanceService.listTasksByInstance(req.params.checklistInstanceId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

module.exports = { complete, listByInstance };
