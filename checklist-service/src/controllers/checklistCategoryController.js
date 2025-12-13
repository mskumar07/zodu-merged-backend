// src/controllers/checklistCategoryController.js
const categoryService = require('../services/checklistCategoryService');

const create = async (req, res, next) => {
  try {
    const row = await categoryService.createCategory(req.body);
    res.status(201).json(row);
  } catch (err) { next(err); }
};

const get = async (req, res, next) => {
  try {
    const row = await categoryService.getCategory(req.params.id);
    if (!row) return res.status(404).json({ message: 'Not found' });
    res.json(row);
  } catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try {
    const rows = await categoryService.listCategories(req.query);
    res.json(rows);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const updated = await categoryService.updateCategory(req.params.id, req.body);
    res.json(updated);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await categoryService.deleteCategory(req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
};

module.exports = { create, get, list, update, remove };
