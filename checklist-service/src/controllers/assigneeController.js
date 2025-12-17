const assignee = require('../services/assigneeService');

const list = async (req, res, next) => {
  try {
    const rows = await assignee.listAssignees(req.query);
    res.json({Data:rows});
  } catch (err) { next(err); }
};

module.exports = { list };