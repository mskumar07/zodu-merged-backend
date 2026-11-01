// Customer-route security: token, company/branch from the token, record ids of
// the caller's company only, route permissions. Services are mocked; the
// database answers only the ownership lookups (src/security/owned.js) from the
// records below.
const request = require('supertest');
const { bearer, USERS } = require('@zodu/security/testing');

// table → column → value → rows ({ zodu_id, branch_id })
const RECORDS = {
  tbl_sales: { sale_uuid: { 'a0000000-0000-4000-8000-000000000001': [['Z001', 'B1']], 'a0000000-0000-4000-8000-000000000002': [['Z002', 'B1']] } },
  tbl_customer: { cust_uuid: { 'c0000000-0000-4000-8000-000000000001': [['Z001', 'B1']], 'c0000000-0000-4000-8000-000000000002': [['Z002', 'B1']] } },
  tbl_menu_items: { item_uuid: { 'b0000000-0000-4000-8000-000000000001': [['Z001', 'B1']], 'b0000000-0000-4000-8000-000000000002': [['Z001', 'B2']] } },
  tbl_inventory: { inventory_uuid: { 'd0000000-0000-4000-8000-000000000002': [['Z002', 'B1']] } },
  // purchase_id is unique per company only: both companies have B1-PO001
  tbl_purchase: { purchase_id: { 'B1-PO001': [['Z001', 'B1'], ['Z002', 'B1']] } },
  tbl_expense: { expense_id: { 'EXP-1': [['Z002', 'B1']] } },
  tbl_category: { id: { 7: [['Z002', 'B1']] } },
};

jest.mock('../src/database/connection', () => {
  const lookup = /FROM (\w+) WHERE (\w+) = \$1( AND zodu_id = \$2)?/;
  return {
    query: jest.fn(async (sql, params = []) => {
      const m = lookup.exec(sql);
      if (!m) return { rows: [] };
      if (m[2] !== 'zodu_id' && !/^[\w-]+$/.test(String(params[0]))) {
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

// Every service function answers { success: true }, so a 2xx means the request got through.
const okService = (path) => jest.mock(path, () => {
  const actual = jest.requireActual(path);
  return Object.fromEntries(Object.keys(actual).map((k) => [k, jest.fn(async () => ({ success: true, data: [] }))]));
});
okService('../src/services/retail-service');
okService('../src/services/branch-service');
okService('../src/services/menu-service');
okService('../src/services/purchase.service');
okService('../src/services/expense-service');
okService('../src/services/vendor-service');
okService('../src/services/sale-service');
okService('../src/services/purchaseReturn-service');
okService('../src/services/dashboard-service');
okService('../src/services/report-service');

const retail = require('../src/services/retail-service');
const purchase = require('../src/services/purchase.service');
const expense = require('../src/services/expense-service');
const menu = require('../src/services/menu-service');
const app = require('../src/express-app');

beforeEach(() => jest.clearAllMocks());

const SALE = 'a0000000-0000-4000-8000-000000000001';
const OTHER_SALE = 'a0000000-0000-4000-8000-000000000002';
const OTHER_CUSTOMER = 'c0000000-0000-4000-8000-000000000002';
const ITEM_B1 = 'b0000000-0000-4000-8000-000000000001';
const ITEM_B2 = 'b0000000-0000-4000-8000-000000000002';

test('no token → 401', async () => {
  expect((await request(app).get('/api/sales/history?zodu_id=Z001&branch_id=B1')).status).toBe(401);
  expect((await request(app).get('/get/pos_data/B1/Z001')).status).toBe(401);
});

test('removed routes (debug, legacy) are closed', async () => {
  const h = bearer(USERS.owner);
  expect((await request(app).get('/api/retail').set(h)).status).toBe(403);
  expect((await request(app).get('/get/purchase/B1-PO001').set(h)).status).toBe(403);
  expect((await request(app).delete('/api/delete/vendor/V001').set(h)).status).toBe(403);
  expect((await request(app).post('/api/branch/signup-default').send({ zodu_id: 'Z009', branch_name: 'x' })).status).toBe(403);
});

test('/internal still wants a service token, not a user token', async () => {
  expect((await request(app).post('/internal/seed-defaults').set(bearer(USERS.owner)).send({})).status).toBe(401);
});

describe('another company', () => {
  test('zodu_id in query, body or path → 404, nothing reaches the service', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).get('/api/sales/history?zodu_id=Z002&branch_id=B1').set(h)).status).toBe(404);
    expect((await request(app).get('/get/units/B1/Z002').set(h)).status).toBe(404);
    expect((await request(app).post('/add/category').set(h).send({ zodu_id: 'Z002', branch_id: 'B1', name: 'x', type: 'menu' })).status).toBe(404);
    expect(retail.getSalesHistory).not.toHaveBeenCalled();
    expect(retail.getUnits).not.toHaveBeenCalled();
    expect(retail.addCategoryData).not.toHaveBeenCalled();
  });

  test('a record id of another company → 404 (sale, customer, category, inventory)', async () => {
    const h = bearer(USERS.owner);
    expect((await request(app).get(`/api/sales/${OTHER_SALE}?zodu_id=Z001&branch_id=B1`).set(h)).status).toBe(404);
    expect((await request(app).post(`/api/sales/${OTHER_SALE}/payment`).set(h).send({ zodu_id: 'Z001', branch_id: 'B1' })).status).toBe(404);
    expect((await request(app).delete(`/api/customers/${OTHER_CUSTOMER}`).set(h)).status).toBe(404);
    expect((await request(app).put('/update/category/7').set(h).send({ zodu_id: 'Z001', branch_id: 'B1', name: 'x' })).status).toBe(404);
    expect((await request(app).post('/api/menu/inventory/adjust').set(h)
      .send({ inventory_uuid: 'd0000000-0000-4000-8000-000000000002', adjustment_type: 'add', adjustment_qty: 5, reason: 'x' })).status).toBe(404);
    expect(retail.getSaleById).not.toHaveBeenCalled();
    expect(retail.deleteCustomer).not.toHaveBeenCalled();
    expect(retail.updateCategoryData).not.toHaveBeenCalled();
    expect(menu.adjustStock).not.toHaveBeenCalled();
  });

  test('editing an order of another company (sale_uuid in the body) → 404', async () => {
    const res = await request(app).put('/api/update/orders').set(bearer(USERS.owner))
      .send({ sale_uuid: OTHER_SALE, zodu_id: 'Z001', branch_id: 'B1', items: [] });
    expect(res.status).toBe(404);
    expect(retail.updateOrder).not.toHaveBeenCalled();
  });

  test('a malformed id is not found, not a 500', async () => {
    expect((await request(app).get('/api/sales/not-a-uuid%27--').set(bearer(USERS.owner))).status).toBe(404);
  });

  test('ids unique per company only: each company reaches its own B1-PO001', async () => {
    await request(app).delete('/api/purchase/B1-PO001').set(bearer(USERS.owner));
    expect(purchase.deletePurchase).toHaveBeenLastCalledWith('B1-PO001', { zodu_id: 'Z001', branch_id: 'B1' });
    await request(app).delete('/api/purchase/B1-PO001').set(bearer(USERS.other));
    expect(purchase.deletePurchase).toHaveBeenLastCalledWith('B1-PO001', { zodu_id: 'Z002', branch_id: 'B1' });
    await request(app).get('/api/purchase/B1-PO001?zodu_id=Z001&branch_id=B1').set(bearer(USERS.owner));
    expect(purchase.getPurchaseById).toHaveBeenLastCalledWith('B1-PO001', expect.objectContaining({ zodu_id: 'Z001' }));
    // EXP-1 exists in Z002 only
    expect((await request(app).delete('/api/expense/EXP-1').set(bearer(USERS.owner))).status).toBe(404);
    expect(expense.deleteExpense).not.toHaveBeenCalled();
  });

  test('multipart customer payment with another company → 404', async () => {
    const res = await request(app).post(`/api/customers/c0000000-0000-4000-8000-000000000001/mark-payment`)
      .set(bearer(USERS.owner)).field('zodu_id', 'Z002').field('branch_id', 'B1').field('bills', '[]');
    expect(res.status).toBe(404);
    expect(retail.markCustomerPayment).not.toHaveBeenCalled();
  });
});

describe('branch', () => {
  test('a record of a branch the user may not use → 404; with access it passes', async () => {
    expect((await request(app).get(`/api/menu/menu_item/${ITEM_B2}`).set(bearer(USERS.cashier))).status).toBe(404);
    expect((await request(app).get(`/api/menu/menu_item/${ITEM_B2}`).set(bearer(USERS.manager))).status).toBe(200);
    expect((await request(app).get(`/api/menu/menu_item/${ITEM_B1}`).set(bearer(USERS.cashier))).status).toBe(200);
  });

  test('a branch the user is not assigned to → 404', async () => {
    expect((await request(app).get('/get/pos_data/B2/Z001').set(bearer(USERS.cashier))).status).toBe(404);
    expect((await request(app).get('/get/pos_data/B9/Z001').set(bearer(USERS.manager))).status).toBe(404);
  });
});

describe('permissions', () => {
  test('a cashier (billing only) can run the POS', async () => {
    const h = bearer(USERS.cashier);
    const ok = async (req) => expect((await req).status).toBeLessThan(300);
    await ok(request(app).get('/get/pos_data/B1/Z001').set(h));
    await ok(request(app).get('/get/category/Z001/B1').set(h));
    await ok(request(app).get('/api/customers?zodu_id=Z001&branch_id=B1').set(h));
    expect((await request(app).post('/add/hold_menu').set(h).send({ zodu_id: 'Z001', branch_id: 'B1' })).status).not.toBe(403);
  });

  test('… but not purchases, reports, the dashboard or deleting sales', async () => {
    const h = bearer(USERS.cashier);
    expect((await request(app).get('/api/purchase?zodu_id=Z001&branch_id=B1').set(h)).status).toBe(403);
    expect((await request(app).get('/api/report/sales/summary').set(h)).status).toBe(403);
    expect((await request(app).get('/api/dashboard/stats').set(h)).status).toBe(403);
    expect((await request(app).delete(`/api/sales/${SALE}`).set(h)).status).toBe(403);
    expect((await request(app).put('/api/doc-sequence/Z001/B1/S').set(h).send({ last_seq: 1 })).status).toBe(403);
  });

  test('the manager (no delete) cannot delete; the owner can', async () => {
    expect((await request(app).delete(`/api/sales/${SALE}`).set(bearer(USERS.manager))).status).toBe(403);
    expect((await request(app).delete(`/api/sales/${SALE}?zodu_id=Z001&branch_id=B1`).set(bearer(USERS.owner))).status).toBe(200);
  });

  test('editing a branch needs branch:edit (owner only for now)', async () => {
    expect((await request(app).put('/api/branch/Z001/B1').set(bearer(USERS.manager)).send({})).status).toBe(403);
  });
});

describe('list queries', () => {
  test('limit capped at 500, SQL in order refused', async () => {
    const h = bearer(USERS.owner);
    await request(app).get('/api/purchase?zodu_id=Z001&branch_id=B1&limit=100000').set(h);
    expect(purchase.getPurchases).toHaveBeenCalledWith(expect.objectContaining({ limit: '500', zodu_id: 'Z001' }));
    expect((await request(app).get('/api/purchase?order=1;DROP%20TABLE%20tbl_purchase').set(h)).status).toBe(400);
  });
});

test('security headers, no x-powered-by', async () => {
  const res = await request(app).get('/get/pos_data/B1/Z001').set(bearer(USERS.owner));
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
});
