const router = require('express').Router();
const { ctrl, validate } = require('./department.controller');
const validator = require('./department.validator');

// Create Department
router.post('/', validate(validator.createDepartment), ctrl.create);

// Get All Departments (Requires ?branch_id=...&page=1)
router.get('/', ctrl.getAll);

// Get Single Department
router.get('/:id', ctrl.getOne);

// Update Department
router.put('/:id', validate(validator.updateDepartment), ctrl.update);

// Delete Department (Soft Delete)
router.delete('/:id', ctrl.delete);

module.exports = router;