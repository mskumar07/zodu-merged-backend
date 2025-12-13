// src/controllers/taskInstanceController.js
const taskInstanceService = require('../services/taskInstanceService');

const complete = async (req, res, next) => {
  try {
    const updated = await taskInstanceService.completeTask(req.params.id, { completed_by: req.body.completed_by || null });
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
