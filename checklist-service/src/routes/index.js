// src/routes/index.js
const express = require('express');
const router = express.Router();

const checklistCtrl = require('../controllers/checklistController');
const checklistInstanceCtrl = require('../controllers/checklistInstanceController');
const taskInstanceCtrl = require('../controllers/taskInstanceController');
const taskController = require('../controllers/taskController');
const scheduleCtrl = require('../controllers/checklistScheduleController');
const categoryCtrl = require('../controllers/checklistCategoryController');
const notificationCtrl = require('../controllers/notificationController');
const assigneeCtrl = require('../controllers/assigneeController');
const taskNotesctrl = require("../controllers/taskNotesController");


// checklist templates
router.post('/checklists/create', checklistCtrl.create);
router.get('/checklists', checklistCtrl.list);
router.get('/checklists/:id', checklistCtrl.getById);
router.patch('/checklists/:id', checklistCtrl.update);
router.delete('/checklists/:id', checklistCtrl.remove);
router.get('/dashboard/summary', checklistCtrl.summary);


// checklist instances
router.post('/checklist-instances', checklistInstanceCtrl.create);
router.get('/checklist-instances/:id', checklistInstanceCtrl.get);

// task instances
router.get('/checklist-instances/:checklistInstanceId/tasks', taskInstanceCtrl.listByInstance);
router.patch('/task-instances/:id/complete', taskInstanceCtrl.complete);
router.get('/task/:id', taskController.getCheckById);

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

router.get("/assignees", assigneeCtrl.list);

// notifications
router.post('/notifications/queue', notificationCtrl.enqueue);
router.get('/checklist-instances/:checklistInstanceId/notifications', notificationCtrl.listByInstance);

//notes
router.post("/task-notes", taskNotesctrl.create);

router.put("/task-notes/:id", taskNotesctrl.update);

router.delete("/task-notes/:id", taskNotesctrl.remove);
router.get(
  "/task-notes/task-instance/:taskInstanceId",
  taskNotesctrl.getByTaskInstance
);

module.exports = router;
