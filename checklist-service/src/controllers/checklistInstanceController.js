// src/controllers/checklistInstanceController.js
const checklistInstanceService = require('../services/checklistInstanceService');

const create = async (req, res, next) => {
  try {
    const { checklist_id, scheduled_for, deadline } = req.body;
    const inst = await checklistInstanceService.createChecklistInstance({ checklist_id, scheduled_for, deadline });
    res.status(201).json(inst);
  } catch (err) {
    next(err);
  }
};

const get = async (req, res, next) => {
  try {
    const inst = await checklistInstanceService.getInstance(req.params.id);
    if (!inst) return res.status(404).json({ message: 'Not found' });
    res.json(inst);
  } catch (err) {
    next(err);
  }
};

module.exports = { create, get };
