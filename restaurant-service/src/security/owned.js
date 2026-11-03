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
// vendor_id, hold_id, ...): they are looked up in the token's company,
// preferring the request's branch. recordOf(req, table) is the row found
// ({ zodu_id, branch_id }), for handlers that act on the record's own branch.
const conn = require('../database/connection');
const security = require('./index');

function lookup(table, column, { code = false } = {}) {
  return async (id, req) => {
    const row = await find(table, column, code, id, req);
    if (row) (req.records ??= {})[table] = row;
    return row;
  };
}

// An id that may be in one of several tables (an open order in tbl_tmp_orders,
// a completed one in tbl_orders): the first table holding it.
function lookupAny(places) {
  return async (id, req) => {
    for (const [table, column] of places) {
      const row = await find(table, column, false, id, req);
      if (row) return ((req.records ??= {})[table] = row);
    }
    return null;
  };
}

async function find(table, column, code, id, req) {
  const { rows } = code
    ? await conn.query(
      `SELECT zodu_id, branch_id FROM ${table} WHERE ${column} = $1 AND zodu_id = $2
       ORDER BY (branch_id = $3) DESC LIMIT 1`,
      [id, req.auth.zoduId, req.tenant?.branchId ?? null],
    )
    : await conn.query(`SELECT zodu_id, branch_id FROM ${table} WHERE ${column} = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

const recordOf = (req, table) => req.records?.[table];

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

const inBodyAny = (field, places) => {
  const check = security.ownedParam(lookupAny(places));
  return (req, res, next) => {
    const value = req.body?.[field];
    if (value === undefined || value === null || value === '') return next();
    return check(req, res, next, value, field);
  };
};

// Order lines name menu items by menu_id (unique across companies); the stock
// updates behind them go by that id alone. A line naming another company's or
// another branch's item → 404, like any record id.
const menuItems = (field = 'items', key = 'menu_id') => async (req, res, next) => {
  try {
    const ids = (Array.isArray(req.body?.[field]) ? req.body[field] : [])
      .map((line) => line?.[key]).filter((id) => id !== undefined && id !== null && id !== '');
    if (!ids.length) return next();
    const { zoduId, branchId } = req.tenant;
    const { rows } = await conn.query(
      `SELECT menu_id FROM tbl_menu_items
        WHERE menu_id::text = ANY($1::text[]) AND NOT (zodu_id = $2 AND branch_id = $3) LIMIT 1`,
      [ids.map(String), zoduId, branchId],
    );
    if (rows.length) return res.status(404).json({ success: false, message: 'Menu item not found' });
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { param, inPath, inBody, inBodyAny, menuItems, recordOf };
