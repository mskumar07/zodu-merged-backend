// src/services/checklistCategoryService.js
const repo = require('../repositories/checklistCategoryRepo');

const createCategory = async (payload) => {
  if (!payload.name) {
    const e = new Error('Category name required');
    e.status = 400;
    throw e;
  }
  return repo.create(payload);
};

const getCategory = async (id) => repo.findById(id);
const listCategories = async (filter) => repo.list(filter);
const updateCategory = async (id, patch) => repo.update(id, patch);
const deleteCategory = async (id) => repo.remove(id);

module.exports = { createCategory, getCategory, listCategories, updateCategory, deleteCategory };
