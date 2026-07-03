const Joi = require('@hapi/joi');

const zodu_branch = {
  zodu_id:   Joi.string().max(50).required(),
  branch_id: Joi.string().max(50).required(),
};

const assignee = Joi.object({
  id:            Joi.string().uuid(),   // present = existing row, absent = new assignee
  employee_id:   Joi.string().uuid().required(),
  employee_name: Joi.string().max(100).required(),
});

const checklist_item = Joi.object({
  id:          Joi.string().uuid(),   // present on update (existing row), absent on create (new row)
  item_order:  Joi.number().integer().min(1).required(),
  item_title:  Joi.string().max(500).required(),
  description: Joi.string().allow(null, ''),
  file_url:    Joi.array().items(Joi.object()).default([]),
});

// ── CREATE ────────────────────────────────────────────────────────────────────

exports.checklist_create = Joi.object({
  ...zodu_branch,
  title:       Joi.string().max(255).required(),
  description: Joi.string().allow(null, ''),
  status:      Joi.string().valid('Not Started', 'In Progress', 'Completed', 'Overdue').default('Not Started'),
  due_date:    Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, ''),
  start_date:  Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, ''),

  assignees: Joi.array().items(assignee).min(1).required(),
  created_by: Joi.string().uuid().required(),
  created_by_name: Joi.string().max(100).required(),
  items:     Joi.array().items(checklist_item).min(1).required(),

  is_recurring:     Joi.boolean().default(false),
  recur_frequency:  Joi.when('is_recurring', {
    is:        true,
    then:      Joi.string().valid('Daily', 'Weekly', 'Monthly', 'Yearly').required(),
    otherwise: Joi.string().allow(null, ''),
  }),
  recur_every: Joi.when('is_recurring', {
    is:        true,
    then:      Joi.number().integer().min(1).required(),
    otherwise: Joi.number().allow(null),
  }),
  recur_ends: Joi.when('is_recurring', {
    is:        true,
    then:      Joi.string().valid('Never', 'On Date').required(),
    otherwise: Joi.string().allow(null, ''),
  }),
  recur_end_date: Joi.when('recur_ends', {
    is:        'On Date',
    then:      Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    otherwise: Joi.string().allow(null, ''),
  }),
  recur_start_date: Joi.when('is_recurring', {
    is:        true,
    then:      Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    otherwise: Joi.string().allow(null, ''),
  }),
});

// ── UPDATE ────────────────────────────────────────────────────────────────────

const attachment_update = Joi.object({
  id:               Joi.string().uuid().required(),
  file_name:        Joi.string().max(500).required(),
  file_url:         Joi.string().max(2000).required(),
  uploaded_by:      Joi.string().uuid().required(),
  uploaded_by_name: Joi.string().required(),
});

exports.checklist_update = Joi.object({
  ...zodu_branch,
  title:       Joi.string().max(255),
  description: Joi.string().allow(null, ''),
  status:      Joi.string().valid('Not Started', 'In Progress', 'Completed', 'Overdue'),
  due_date:    Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, ''),
  start_date:  Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, ''),
  attachments: Joi.array().items(attachment_update).min(1),

  assignees:        Joi.array().items(assignee).min(1),
  created_by:       Joi.string().uuid(),
  created_by_name:  Joi.string().max(100),
  items:            Joi.array().items(checklist_item).min(1),

  is_recurring:     Joi.boolean(),
  recur_frequency:  Joi.string().valid('Daily', 'Weekly', 'Monthly', 'Yearly').allow(null, ''),
  recur_every:      Joi.number().integer().min(1).allow(null),
  recur_ends:       Joi.string().valid('Never', 'On Date').allow(null, ''),
  recur_end_date:   Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, ''),
  recur_start_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, ''),
}).min(1);

// ── COMPLETE ITEM  (employee marks an item done) ──────────────────────────────

exports.item_progress = Joi.object({
  instance_id:  Joi.string().uuid().required(),
  item_id:      Joi.string().uuid().required(),
  employee_id:  Joi.string().uuid().required(),
  is_completed: Joi.boolean().required(),
});

// ── UPDATE TASK STATUS  (admin "Update Task Status" modal — bulk item update) ─

exports.task_status_update = Joi.object({
  ...zodu_branch,
  items: Joi.array().items(Joi.object({
    item_id:     Joi.string().uuid().required(),
    status:      Joi.string().valid('Not Started', 'Completed', 'In Progress', 'Cancelled').required(),
    remarks:     Joi.string().max(2000).allow(null, ''),
    employee_id: Joi.string().uuid().allow(null),
  })).min(1).required(),
});
