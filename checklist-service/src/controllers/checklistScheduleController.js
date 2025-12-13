// src/controllers/checklistScheduleController.js
const scheduleService = require('../services/checklistScheduleService');

const create = async (req, res, next) => {
  try {
    const row = await scheduleService.createSchedule(req.body);
    res.status(201).json(row);
  } catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try {
    const rows = await scheduleService.listByChecklist(req.params.checklistId);
    res.json(rows);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const updated = await scheduleService.updateSchedule(req.params.id, req.body);
    res.json(updated);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await scheduleService.deleteSchedule(req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
};

module.exports = { create, list, update, remove };
