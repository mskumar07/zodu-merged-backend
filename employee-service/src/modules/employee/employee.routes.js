const router = require('express').Router();
const { ctrl, validate } = require('./employee.controller');
const validator = require('./employee.validator');

router.post('/', validate(validator.createEmployee), ctrl.create);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.put('/:id', validate(validator.updateEmployee), ctrl.update);
router.delete('/:id', ctrl.delete);

module.exports = router;