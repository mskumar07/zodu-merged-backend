// services/taskNotesService.js
const repo = require("../repositories/taskNotesRepo");

exports.createNote = async (data) => {
    console.log("service",data);
  if (!data.task_id || !data.note) {
    throw new Error("task_instance_id and note are required");
  }
  return repo.create(data);
};

exports.updateNote = async (id, note) => {
  if (!id || !note) {
    throw new Error("id and note are required");
  }
  return repo.update({ id, note });
};

exports.deleteNote = async (id) => {
  if (!id) {
    throw new Error("id is required");
  }
  return repo.remove(id);
};

exports.getNotes = async (task_instance_id) => {
  if (!task_instance_id) {
    throw new Error("task_instance_id is required");
  }
  return repo.getByTaskInstance(task_instance_id);
};
