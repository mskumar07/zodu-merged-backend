// Customer-route security: token, company/branch from the token, record ids of
// the caller's company only, route permissions. Services are mocked; the
// database answers only the ownership lookups (src/security/owned.js) from the
// records below.
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');

const ORDER = 'a0000000-0000-4000-8000-000000000001';
const OTHER_ORDER = 'a0000000-0000-4000-8000-000000000002';
const OPEN_ORDER = 'e0000000-0000-4000-8000-000000000001';
const OTHER_OPEN_ORDER = 'e0000000-0000-4000-8000-000000000002';
const OTHER_CUSTOMER = 'c0000000-0000-4000-8000-000000000002';

// table → column → value → rows ({ zodu_id, branch_id })
const RECORDS = {
  tbl_orders: { api_order_id: { [ORDER]: [['Z001', 'B1']], [OTHER_ORDER]: [['Z002', 'B1']] } },
  tbl_tmp_orders: { api_order_id: { [OPEN_ORDER]: [['Z001', 'B1']], [OTHER_OPEN_ORDER]: [['Z002', 'B1']] } },
  tbl_customer: { cust_uuid: { [OTHER_CUSTOMER]: [['Z002', 'B1']] } },
  // menu_id is unique across companies
  tbl_menu_items: { menu_id: { M1: [['Z001', 'B1']], M2: [['Z001', 'B2']], M9: [['Z002', 'B1']] } },
  tbl_units: { id: { 3: [['Z002', 'B1']], 4: [['Z001', 'B1']] } },
  tbl_category: { id: { 7: [['Z002', 'B1']] } },
  tbl_inventory: { inventory_id: { 5: [['Z002', 'B1']] }, inventory_uuid: { 'd0000000-0000-4000-8000-000000000002': [['Z002', 'B1']] } },
  // purchase_id and hold_id are unique per company only: both companies have them
  tbl_purchase: { purchase_id: { 'B1-PO001': [['Z001', 'B1'], ['Z002', 'B1']] } },
  tbl_hold: { hold_id: { 'HOLD-000001': [['Z001', 'B1'], ['Z002', 'B1']], 'HOLD-000009': [['Z002', 'B1']] } },
  tbl_vendor: { id: { 4: [['Z002', 'B1']] } },
};

jest.mock('../src/database/connection', () => {
  const lookup = /FROM (\w+) WHERE (\w+) = \$1( AND zodu_id = \$2)?/;
  const items = /FROM tbl_menu_items\s+WHERE menu_id::text = ANY/;
  return {
    query: jest.fn(async (sql, params = []) => {
      if (items.test(sql)) {
        const [ids, zodu, branch] = params;
        const rows = ids.filter((id) => (RECORDS.tbl_menu_items.menu_id[id] ?? [])
          .some(([z, b]) => !(z === zodu && b === branch))).map((menu_id) => ({ menu_id }));
        return { rows };
      }
      const m = lookup.exec(sql);
      if (!m) return { rows: [] };
      if (!/^[\w-]+$/.test(String(params[0]))) {
        throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
      }
      const rows = (RECORDS[m[1]]?.[m[2]]?.[params[0]] ?? [])
        .map(([zodu_id, branch_id]) => ({ zodu_id, branch_id }))
        .filter((r) => !m[3] || r.zodu_id === params[1]);
      return { rows };
    }),
    connect: jest.fn(),
  };
});

// Every service function answers { success: true }, so a 2xx means the request
// got through. The services require each other, so the mocks are built on
// first use rather than from the real modules.
const okService = (path) => jest.mock(path, () => new Proxy({}, {
  get: (fns, name) => (typeof name !== 'string' || name === '__esModule' || name === 'then'
    ? undefined
    : (fns[name] ??= jest.fn(async () => ({ success: true, data: [] })))),
}));
okService('../src/services/restaurant-service');
okService('../src/services/branch-service');
okService('../src/services/menu-service');
okService('../src/services/purchase.service');
okService('../src/services/expense-service');
okService('../src/services/vendor-service');
okService('../src/services/purchaseReturn-service');
okService('../src/services/dashboard-service');
okService('../src/services/report-service');
okService('../src/services/inventory-service');
okService('../src/services/orders-service');
okService('../src/services/kot-service');
okService('../src/services/hold-item-service');

const restaurant = require('../src/services/restaurant-service');
const orders = require('../src/services/orders-service');
const menu = require('../src/services/menu-service');
const inventory = require('../src/services/inventory-service');
const purchase = require('../src/services/purchase.service');
const kot = require('../src/services/kot-service');
const hold = require('../src/services/hold-item-service');
const app = require('../src/express-app');

beforeEach(() => jest.clearAllMocks());

const line = (menu_id) => ({ menu_id, name: 'x', qty: 1, price: 10 });
// Past the security checks: the route's own validation may still answer 400.
const passes = (status) => expect([401, 403, 404]).not.toContain(status);

test('no token → 401', async () => {
  expect((await request(app).get('/get/pos_data/B1/Z001')).status).toBe(401);
  expect((await request(app).post('/api/completeorder').send({})).status).toBe(401);
  expect((await request(app).get('/get/kot-counters/Z001/B1')).status).toBe(401);
});

test('removed routes (legacy, retail-only) are closed', async () => {
  const h = bearer(USERS.owner);
  expect((await request(app).post('/api/add/product').set(h).send({})).status).toBe(403);
  expect((await request(app).delete('/api/delete/vendor/4').set(h)).status).toBe(403);
  expect((await request(app).post('/api/products/upload-excel').set(h)).status).toBe(403);
  expect((await request(app).get('/api/sale-returns?zodu_id=Z001&branch_id=B1').set(h)).status).toBe(403);
  expect((await request(app).post('/api/branch/signup-default').send({ zodu_id: 'Z009' })).status).toBe(403);
});

test('/internal still wants a service token, not a user token', async () => {
  expect((await request(app).post('/internal/seed-defaults').set(bearer(USERS.owner)).send({})).status).toBe(401);
});

describe('another company', () => {
  test('zodu_id in path, query or body → 404, nothing reaches the service', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).get('/get/pos_data/B1/Z002').set(h)).status).toBe(404);
    expect((await request(app).get('/get/kot-printers/Z002/B1').set(h)).status).toBe(404);
    expect((await request(app).get('/api/menu/get/menu_item/Z002/B1').set(h)).status).toBe(404);
    expect((await request(app).get('/api/sales/history?zodu_id=Z002&branch_id=B1').set(h)).status).toBe(404);
    expect((await request(app).post('/add/kot-counter').set(h).send({ zodu_id: 'Z002', branch_id: 'B1', counter_name: 'x' })).status).toBe(404);
    expect(restaurant.get_pos_data).not.toHaveBeenCalled();
    expect(kot.listPrinters).not.toHaveBeenCalled();
    expect(kot.createCounter).not.toHaveBeenCalled();
  });

  test('a record id of another company → 404 (order, customer, menu item, unit, category, inventory, vendor)', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).get(`/api/sales/data/get/${OTHER_ORDER}`).set(h)).status).toBe(404);
    expect((await request(app).delete(`/api/sales/${OTHER_ORDER}`).set(h)).status).toBe(404);
    expect((await request(app).delete(`/api/customers/${OTHER_CUSTOMER}`).set(h)).status).toBe(404);
    expect((await request(app).put('/api/menu/update/menusfav/true/M9').set(h)).status).toBe(404);
    expect((await request(app).put('/update/favorite/true/M9').set(h)).status).toBe(404);
    expect((await request(app).delete('/api/menu/delete/menu_item/M9').set(h)).status).toBe(404);
    expect((await request(app).put('/update/unit/3').set(h).send({ name: 'x', short_name: 'x' })).status).toBe(404);
    expect((await request(app).post('/replace/unit').set(h).send({ old_unit_id: 4, new_unit_id: 3, branch_id: 'B1' })).status).toBe(404);
    expect((await request(app).put('/update/category/7').set(h).send({ zodu_id: 'Z001', branch_id: 'B1', name: 'x' })).status).toBe(404);
    expect((await request(app).put('/api/inventory/api/update/inventory').set(h).send({ inventory_id: 5 })).status).toBe(404);
    expect((await request(app).post('/api/inventory/adjust').set(h)
      .send({ inventory_uuid: 'd0000000-0000-4000-8000-000000000002', adjustment_type: 'add', adjustment_qty: 5, reason: 'x' })).status).toBe(404);
    expect((await request(app).put('/api/vendor/4').set(h).send({})).status).toBe(404);
    expect(restaurant.getSaleById).not.toHaveBeenCalled();
    expect(restaurant.deleteSale).not.toHaveBeenCalled();
    expect(restaurant.deleteCustomer).not.toHaveBeenCalled();
    expect(restaurant.updateMenuFav).not.toHaveBeenCalled();
    expect(menu.updateMenusFav).not.toHaveBeenCalled();
    expect(menu.deleteMenuItem).not.toHaveBeenCalled();
    expect(restaurant.updateUnit).not.toHaveBeenCalled();
    expect(restaurant.replaceUnit).not.toHaveBeenCalled();
    expect(restaurant.updateCategoryData).not.toHaveBeenCalled();
    expect(inventory.update_Inventory).not.toHaveBeenCalled();
    expect(inventory.adjustStock).not.toHaveBeenCalled();
  });

  test('a sale is read and cancelled in its own company and branch', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).get(`/api/sales/data/get/${ORDER}`).set(h)).status).toBe(200);
    expect(restaurant.getSaleById).toHaveBeenCalledWith(ORDER, 'Z001', 'B1');
    // ?zodu_id=Z002 cannot redirect the cancel either
    await request(app).delete(`/api/sales/${ORDER}`).set(h).send({ items: [{ item_id: 'M1', qty: 1 }] });
    expect(restaurant.deleteSale).toHaveBeenCalledWith(ORDER, 'Z001', 'B1', [{ item_id: 'M1', qty: 1 }]);
  });

  test('completing or editing an order of another company → 404', async () => {
    const h = bearer(USERS.owner);
    const body = { zodu_id: 'Z001', branch_id: 'B1', payment_type: 'Cash', items: [] };
    expect((await request(app).post('/api/completeorder').set(h).send({ ...body, api_order_id: OTHER_OPEN_ORDER })).status).toBe(404);
    expect((await request(app).post('/api/completeorder').set(h).send({ ...body, api_order_id: OTHER_ORDER })).status).toBe(404);
    expect((await request(app).put('/api/orders/update/orders').set(h).send({ ...body, api_order_id: OTHER_OPEN_ORDER })).status).toBe(404);
    expect(restaurant.update_Final_payment).not.toHaveBeenCalled();
    expect(orders.updateOrder).not.toHaveBeenCalled();
    // its own open order goes through
    passes((await request(app).post('/api/completeorder').set(h).send({ ...body, api_order_id: OPEN_ORDER })).status);
  });

  test("order lines naming another company's or branch's menu item → 404 (stock is moved by menu_id)", async () => {
    const h = bearer(USERS.owner);
    const order = { zodu_id: 'Z001', branch_id: 'B1', order_type: 'Dine-In' };
    expect((await request(app).post('/api/orders/add/orders').set(h).send({ ...order, items: [line('M1'), line('M9')] })).status).toBe(404);
    expect((await request(app).post('/api/orders/add/orders').set(h).send({ ...order, items: [line('M2')] })).status).toBe(404);
    expect((await request(app).delete(`/api/sales/${ORDER}`).set(h).send({ items: [{ item_id: 'M9', qty: 3 }] })).status).toBe(404);
    expect(orders.createOrder).not.toHaveBeenCalled();
    expect(restaurant.deleteSale).not.toHaveBeenCalled();
  });

  test('ids unique per company only: each company reaches its own record', async () => {
    await request(app).delete('/api/purchase/B1-PO001').set(bearer(USERS.owner));
    expect(purchase.deletePurchase).toHaveBeenLastCalledWith('B1-PO001', { zodu_id: 'Z001', branch_id: 'B1' });
    await request(app).delete('/api/purchase/B1-PO001').set(bearer(USERS.other));
    expect(purchase.deletePurchase).toHaveBeenLastCalledWith('B1-PO001', { zodu_id: 'Z002', branch_id: 'B1' });
    // HOLD-000009 exists in Z002 only
    expect((await request(app).delete('/api/hold/delete/hold-menu/HOLD-000009').set(bearer(USERS.owner))).status).toBe(404);
    expect(hold.deleteHoldMenu).not.toHaveBeenCalled();
  });

  test('a malformed id is not found, not a 500', async () => {
    expect((await request(app).get("/api/sales/data/get/x'--").set(bearer(USERS.owner))).status).toBe(404);
  });
});

describe('branch', () => {
  test('a menu item of a branch the user may not use → 404; with access it passes', async () => {
    expect((await request(app).put('/api/menu/update/menusfav/true/M2').set(bearer(USERS.cashier))).status).toBe(403);
    expect((await request(app).put('/api/menu/update/menusfav/true/M2').set(bearer(USERS.manager))).status).toBeLessThan(300);
  });

  test('a branch the user is not assigned to → 404', async () => {
    expect((await request(app).get('/get/pos_data/B2/Z001').set(bearer(USERS.cashier))).status).toBe(404);
    expect((await request(app).get('/api/orders/get/kot-list/Z001/B9').set(bearer(USERS.manager))).status).toBe(404);
  });
});

describe('permissions', () => {
  test('a cashier (billing only) can run the POS and the kitchen screen', async () => {
    const h = bearer(USERS.cashier);
    const ok = async (req) => expect((await req).status).toBeLessThan(300);
    await ok(request(app).get('/get/pos_data/B1/Z001').set(h));
    await ok(request(app).get('/get/category/Z001/B1').set(h));
    await ok(request(app).get('/api/menu/get/menu_item/Z001/B1').set(h));
    await ok(request(app).get('/api/orders/get/kot-list/Z001/B1').set(h));
    await ok(request(app).get('/get/kot-config/Z001/B1').set(h));
    passes((await request(app).post('/api/orders/add/orders').set(h).send({ zodu_id: 'Z001', branch_id: 'B1', items: [line('M1')] })).status);
    passes((await request(app).post('/api/completeorder').set(h).send({ zodu_id: 'Z001', branch_id: 'B1', api_order_id: OPEN_ORDER })).status);
  });

  test('… but not KOT setup, menu edits, purchases, reports, the dashboard or cancelling sales', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).post('/add/kot-printer').set(h).send({ zodu_id: 'Z001', branch_id: 'B1' })).status).toBe(403);
    expect((await request(app).put('/update/kot-settings').set(h).send({ zodu_id: 'Z001', branch_id: 'B1' })).status).toBe(403);
    expect((await request(app).put('/api/menu/update/menustatus/false/M1').set(h)).status).toBe(403);
    expect((await request(app).get('/api/purchase?zodu_id=Z001&branch_id=B1').set(h)).status).toBe(403);
    expect((await request(app).get('/api/report/sales/summary').set(h)).status).toBe(403);
    expect((await request(app).get('/api/orders/api/report/orders?zodu_id=Z001&branch_id=B1').set(h)).status).toBe(403);
    expect((await request(app).get('/api/dashboard/stats').set(h)).status).toBe(403);
    expect((await request(app).delete(`/api/sales/${ORDER}`).set(h)).status).toBe(403);
  });

  test('the manager (no delete) cannot delete; the owner can', async () => {
    expect((await request(app).delete('/api/menu/delete/menu_item/M1').set(bearer(USERS.manager))).status).toBe(403);
    expect((await request(app).delete('/api/menu/delete/menu_item/M1').set(bearer(USERS.owner))).status).toBe(200);
  });
});

test('security headers, no x-powered-by', async () => {
  const res = await request(app).get('/get/pos_data/B1/Z001').set(bearer(USERS.owner));
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
});
