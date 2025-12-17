const taskService = require('../services/taskService');

const getCheckById = async (req, res, next) => {
  try {
    const task = await taskService.listByChecklistId(req.params.id);        
    if (!task) return res.status(404).json({ message: 'Not found' });
    res.json({Data:task});
  } catch (err) {
    next(err);
  }
};

module.exports = { getCheckById };