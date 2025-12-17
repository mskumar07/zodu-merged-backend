// src/controllers/checklistController.js
const { sum } = require('pdf-lib');
const checklistService = require('../services/checklistService');

// const create = async (req, res, next) => {
//   try {
//     const row = await checklistService.createChecklist(req.body);
//     res.status(201).json(row);
//   } catch (err) {
//     next(err);
//   }
// };

const create = async (req, res, next) => {
  try {
    const result = await checklistService.createChecklistWithDetails(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const row = await checklistService.getChecklist(req.params.id);
    if (!row) return res.status(404).json({ message: 'Not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
};

const list = async (req, res, next) => {
  try {
        console.log(req.query)

    const rows = await checklistService.listChecklists(req.query);
    res.json({Data:rows});
  } catch (err) {
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const updated = await checklistService.updateChecklist(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    await checklistService.deleteChecklist(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const summary = async (req, res) => {
  const { zodu_id, branch_id, user_id } = req.query;

  const data = await checklistService.getDashboardSummary({
    zodu_id,
    branch_id,
    user_id
  });

  res.json(data);
};

module.exports = { create, getById, list, update, remove,summary };
