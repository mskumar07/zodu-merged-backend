// src/controllers/notificationController.js
const notificationService = require('../services/notificationService');

const enqueue = async (req, res, next) => {
  try {
    const body = req.body;
    await notificationService.enqueueNotification(body);
    res.status(202).json({ message: 'Notification queued' });
  } catch (err) { next(err); }
};

const listByInstance = async (req, res, next) => {
  try {
    const rows = await notificationService.listNotificationsByInstance(req.params.checklistInstanceId);
    res.json(rows);
  } catch (err) { next(err); }
};

module.exports = { enqueue, listByInstance };
