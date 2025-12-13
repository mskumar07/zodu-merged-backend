// src/routes/index.js
const express = require('express');
const router = express.Router();

const checklistCtrl = require('../controllers/checklistController');
const checklistInstanceCtrl = require('../controllers/checklistInstanceController');
const taskInstanceCtrl = require('../controllers/taskInstanceController');
const scheduleCtrl = require('../controllers/checklistScheduleController');
const categoryCtrl = require('../controllers/checklistCategoryController');
const notificationCtrl = require('../controllers/notificationController');

// checklist templates
router.post('/checklists', checklistCtrl.create);
router.get('/checklists', checklistCtrl.list);
router.get('/checklists/:id', checklistCtrl.getById);
router.patch('/checklists/:id', checklistCtrl.update);
router.delete('/checklists/:id', checklistCtrl.remove);

// checklist instances
router.post('/checklist-instances', checklistInstanceCtrl.create);
router.get('/checklist-instances/:id', checklistInstanceCtrl.get);

// task instances
router.get('/checklist-instances/:checklistInstanceId/tasks', taskInstanceCtrl.listByInstance);
router.patch('/task-instances/:id/complete', taskInstanceCtrl.complete);

// schedules
router.post('/checklists/:checklistId/schedules', scheduleCtrl.create);
router.get('/checklists/:checklistId/schedules', scheduleCtrl.list);
router.patch('/schedules/:id', scheduleCtrl.update);
router.delete('/schedules/:id', scheduleCtrl.remove);

// categories
router.post('/categories', categoryCtrl.create);
router.get('/categories', categoryCtrl.list);
router.get('/categories/:id', categoryCtrl.get);
router.patch('/categories/:id', categoryCtrl.update);
router.delete('/categories/:id', categoryCtrl.remove);

// notifications
router.post('/notifications/queue', notificationCtrl.enqueue);
router.get('/checklist-instances/:checklistInstanceId/notifications', notificationCtrl.listByInstance);

module.exports = router;
