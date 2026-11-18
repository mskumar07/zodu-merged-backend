// Categories and dashboards: small enough to share a file.
const express = require('express');
const pool = require('../database/pool');
const { withTransaction } = require('../database/tx');
const { tenantOf, callerOf, myEmployeeId } = require('../security/request');
const { uuidParams } = require('./params');
const dashboard = require('../services/dashboard');
const settingsService = require('../services/settings');
const schema = require('../schema');
const { ah, conflict, notFound } = require('../utils/errors');

// Categories belong to the company (every branch shares them); there are no defaults.
const categories = uuidParams(express.Router(), 'id');
const CATEGORY_COLS = 'id, name, color, icon, sort_order';

categories.get('/', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${CATEGORY_COLS} FROM ckl.categories WHERE is_active AND zodu_id = $1 ORDER BY sort_order, lower(name)`,
    [tenantOf(req).zodu_id],
  );
  res.json({ success: true, data: rows });
}));

// Names are unique per company, ignoring case (uq_categories_name backs this up).
async function checkNameFree(db, zoduId, name, exceptId = null) {
  const { rows: [dup] } = await db.query(
    'SELECT 1 FROM ckl.categories WHERE zodu_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3',
    [zoduId, name, exceptId],
  );
  if (dup) throw conflict('A category with this name already exists', 'CATEGORY_EXISTS');
}

const uniqueViolation = (err) => {
  if (err.code === '23505') throw conflict('A category with this name already exists', 'CATEGORY_EXISTS');
  throw err;
};

categories.post('/', ah(async (req, res) => {
  const body = schema.validate(schema.createCategory, req.body, { label: 'category' });
  const z = tenantOf(req).zodu_id;
  await checkNameFree(pool, z, body.name);
  const { rows: [row] } = await pool.query(
    `INSERT INTO ckl.categories (zodu_id, name, color, icon, sort_order) VALUES ($1, $2, $3, $4, $5)
     RETURNING ${CATEGORY_COLS}`,
    [z, body.name, body.color, body.icon ?? null, body.sort_order],
  ).catch(uniqueViolation);
  res.status(201).json({ success: true, data: row });
}));

// Rename / recolour. A new name also shows on the runs already made from it.
categories.put('/:id', ah(async (req, res) => {
  const body = schema.validate(schema.updateCategory, req.body, { label: 'category' });
  const z = tenantOf(req).zodu_id;
  const row = await withTransaction(async (db) => {
    if (body.name !== undefined) await checkNameFree(db, z, body.name, req.params.id);
    const { rows: [r] } = await db.query(
      `UPDATE ckl.categories
          SET name = COALESCE($3, name), color = COALESCE($4, color), icon = COALESCE($5, icon),
              sort_order = COALESCE($6, sort_order)
        WHERE id = $1 AND zodu_id = $2 AND is_active
        RETURNING ${CATEGORY_COLS}`,
      [req.params.id, z, body.name ?? null, body.color ?? null, body.icon ?? null, body.sort_order ?? null],
    );
    if (!r) throw notFound('Category not found');
    if (body.name !== undefined) {
      await db.query('UPDATE ckl.runs SET category_name = $3 WHERE category_id = $1 AND zodu_id = $2', [r.id, z, r.name]);
    }
    return r;
  }).catch(uniqueViolation);
  res.json({ success: true, data: row });
}));

// Checklists using it become uncategorised; runs already made keep the name they show.
categories.delete('/:id', ah(async (req, res) => {
  const z = tenantOf(req).zodu_id;
  await withTransaction(async (db) => {
    await db.query('UPDATE ckl.checklists SET category_id = NULL WHERE category_id = $1 AND zodu_id = $2', [req.params.id, z]);
    const { rowCount } = await db.query('DELETE FROM ckl.categories WHERE id = $1 AND zodu_id = $2', [req.params.id, z]);
    if (!rowCount) throw notFound('Category not found');
  });
  res.status(204).end();
}));

// Task sub-statuses belong to the company (Settings): read by anyone signed in (they
// pick one on a task), managed with the checklist create / edit / delete permissions.
const taskStatuses = uuidParams(express.Router(), 'id');
const STATUS_COLS = 'id, name, color, closes_task, sort_order';
const statusTaken = (err) => {
  if (err.code === '23505') throw conflict('A status with this name already exists', 'TASK_STATUS_EXISTS');
  throw err;
};

taskStatuses.get('/', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${STATUS_COLS} FROM ckl.task_statuses WHERE zodu_id = $1 ORDER BY sort_order, lower(name)`,
    [tenantOf(req).zodu_id],
  );
  res.json({ success: true, data: rows });
}));

taskStatuses.post('/', ah(async (req, res) => {
  const body = schema.validate(schema.createTaskStatus, req.body, { label: 'status' });
  const { rows: [row] } = await pool.query(
    `INSERT INTO ckl.task_statuses (zodu_id, name, color, closes_task, sort_order) VALUES ($1, $2, $3, $4, $5)
     RETURNING ${STATUS_COLS}`,
    [tenantOf(req).zodu_id, body.name, body.color, body.closes_task, body.sort_order],
  ).catch(statusTaken);
  res.status(201).json({ success: true, data: row });
}));

// A new name or colour also shows on tasks that already have the status; whether it
// closes a task applies from now on (tasks already marked keep what they had).
taskStatuses.put('/:id', ah(async (req, res) => {
  const body = schema.validate(schema.updateTaskStatus, req.body, { label: 'status' });
  const z = tenantOf(req).zodu_id;
  const row = await withTransaction(async (db) => {
    const { rows: [r] } = await db.query(
      `UPDATE ckl.task_statuses
          SET name = COALESCE($3, name), color = COALESCE($4, color), closes_task = COALESCE($5, closes_task),
              sort_order = COALESCE($6, sort_order)
        WHERE id = $1 AND zodu_id = $2
        RETURNING ${STATUS_COLS}`,
      [req.params.id, z, body.name ?? null, body.color ?? null, body.closes_task ?? null, body.sort_order ?? null],
    );
    if (!r) throw notFound('Status not found');
    await db.query(
      `UPDATE ckl.run_items SET sub_status_name = $2, sub_status_color = $3,
              skip_reason = CASE WHEN is_skipped THEN $2 ELSE skip_reason END
        WHERE sub_status_id = $1 AND (sub_status_name <> $2 OR sub_status_color <> $3)`,
      [r.id, r.name, r.color],
    );
    return r;
  }).catch(statusTaken);
  res.json({ success: true, data: row });
}));

// Tasks that already have it keep it (as a snapshot); it just can't be picked any more.
taskStatuses.delete('/:id', ah(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM ckl.task_statuses WHERE id = $1 AND zodu_id = $2', [req.params.id, tenantOf(req).zodu_id]);
  if (!rowCount) throw notFound('Status not found');
  res.status(204).end();
}));

// Checklist settings for the whole company: read by anyone signed in (the
// create form shows them), changed with checklist:edit.
const settings = express.Router();

settings.get('/', ah(async (req, res) => {
  res.json({ success: true, data: await settingsService.get(tenantOf(req).zodu_id) });
}));

settings.put('/', ah(async (req, res) => {
  const body = schema.validate(schema.companySettings, req.body, { label: 'settings' });
  res.json({ success: true, data: await settingsService.update(tenantOf(req), callerOf(req), body) });
}));

const dashboards = express.Router();

dashboards.get('/my', ah(async (req, res) => {
  const q = schema.validate(schema.dashboardRange, req.query, { label: 'range' });
  res.json({ success: true, data: await dashboard.my(tenantOf(req), await myEmployeeId(req), q) });
}));

dashboards.get('/team', ah(async (req, res) => {
  const q = schema.validate(schema.dashboardRange, req.query, { label: 'range' });
  res.json({ success: true, data: await dashboard.team(tenantOf(req), q) });
}));

module.exports = { categories, dashboards, settings, taskStatuses };
