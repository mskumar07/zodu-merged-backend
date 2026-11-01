// A record id in the request must name a record of the caller's company, in a
// branch the caller may use (@zodu/security ownedParam: another company's
// record or an unknown id → 404; another branch → that branch's access and
// permissions).
//
//   router.param('item_uuid', owned.param('tbl_menu_items', 'item_uuid'));
//   router.put('/x/:id', owned.inPath('id', 'tbl_units', 'id'), handler);
//   router.post('/adjust', owned.inBody('inventory_uuid', 'tbl_inventory', 'inventory_uuid'), handler);
//
// { code: true } for ids unique per company only (purchase_id, expense_id,
// vendor_id, ...): they are looked up in the token's company, preferring the
// request's branch.
const conn = require('../database/connection');
const security = require('./index');

function lookup(table, column, { code = false } = {}) {
  return async (id, req) => {
    const { rows } = code
      ? await conn.query(
        `SELECT zodu_id, branch_id FROM ${table} WHERE ${column} = $1 AND zodu_id = $2
         ORDER BY (branch_id = $3) DESC LIMIT 1`,
        [id, req.auth.zoduId, req.tenant?.branchId ?? null],
      )
      : await conn.query(`SELECT zodu_id, branch_id FROM ${table} WHERE ${column} = $1 LIMIT 1`, [id]);
    return rows[0] ?? null;
  };
}

const param = (table, column, opts) => security.ownedParam(lookup(table, column, opts));

const inPath = (name, table, column, opts) => {
  const check = param(table, column, opts);
  return (req, res, next) => check(req, res, next, req.params[name], name);
};

// Absent field: left to the route's validation.
const inBody = (field, table, column, opts) => {
  const check = param(table, column, opts);
  return (req, res, next) => {
    const value = req.body?.[field];
    if (value === undefined || value === null || value === '') return next();
    return check(req, res, next, value, field);
  };
};

module.exports = { param, inPath, inBody };
