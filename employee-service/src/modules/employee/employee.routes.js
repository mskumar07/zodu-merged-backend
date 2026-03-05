const router = require('express').Router();
const { ctrl, validate } = require('./employee.controller');
const validator = require('./employee.validator');
const multer = require("multer");
const upload = multer();

// Middleware to parse JSON stringified fields from FormData


router.post('/',   upload.single("face"),
validate(validator.createEmployee), ctrl.create);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.put('/:id',   upload.single("face"),
validate(validator.updateEmployee), ctrl.update);
router.delete('/:id', ctrl.delete);

module.exports = router;