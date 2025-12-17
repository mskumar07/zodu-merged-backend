// controllers/taskNotesController.js
const service = require("../services/taskNotesService");

/**
 * POST /task-notes
 */
const create = async (req, res) => {
  try {
    console.log(req.body);
    const note = await service.createNote({
      task_id: req.body.task_id,
      note: req.body.note,
      created_by: req.body.created_by || null, // from auth middleware
    });
    res.status(201).json({ success: true, data: note });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * PUT /task-notes/:id
 */
const update = async (req, res) => {
  try {
    const note = await service.updateNote(
      req.params.id,
      req.body.note
    );
    res.json({ success: true, data: note });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /task-notes/:id
 */
const remove = async (req, res) => {
  try {
    const deleted = await service.deleteNote(req.params.id);
    res.json({ success: true, data: deleted });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * GET /task-notes/task-instance/:taskInstanceId
 */
const getByTaskInstance = async (req, res) => {
  try {
    const notes = await service.getNotes(req.params.taskInstanceId);
    res.json({ success: true, data: notes });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};


module.exports = { create, update, remove, getByTaskInstance };