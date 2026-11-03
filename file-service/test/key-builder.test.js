// Runs without MinIO: npm test
const test   = require('node:test');
const assert = require('node:assert/strict');
const { buildKey, entityPrefix, assertKeyBelongsTo } = require('../src/storage/key-builder');

const ctx = { zoduId: 'Z001', branchId: 'B1' };
const UUID = '[0-9a-f-]{36}';

test('branch module key: zodu → branch → module → record → uuid', () => {
  const key = buildKey({ ...ctx, module: 'expense', entityId: 'EXP-B1-001', mimeType: 'image/png' });
  assert.match(key, new RegExp(`^Z001/B1/expense/EXP-B1-001/${UUID}\\.png$`));
});

test('menu-items: images directly in the module folder, no folder per item', () => {
  const key = buildKey({ ...ctx, module: 'menu-items', entityId: 'M1', mimeType: 'image/png' });
  assert.match(key, new RegExp(`^Z001/B1/menu-items/${UUID}\\.png$`));
});

test('a missing record id ("undefined" / "null") is refused, not used as a folder', () => {
  for (const entityId of ['undefined', 'null', 'UNDEFINED', undefined, '']) {
    assert.throws(() => buildKey({ ...ctx, module: 'purchase', entityId, mimeType: 'image/png' }), (e) => e.status === 400);
  }
});

test('two uploads for the same record share the folder but never the file name', () => {
  const a = buildKey({ ...ctx, module: 'expense', entityId: 'EXP1', mimeType: 'image/png' });
  const b = buildKey({ ...ctx, module: 'expense', entityId: 'EXP1', mimeType: 'image/png' });
  assert.equal(a.slice(0, a.lastIndexOf('/')), b.slice(0, b.lastIndexOf('/')));
  assert.notEqual(a, b);
});

test('tenant-scoped module goes to _shared, branch ignored', () => {
  const key = buildKey({ ...ctx, module: 'branding', entityId: 'LOGO', mimeType: 'image/webp' });
  assert.match(key, new RegExp(`^Z001/_shared/branding/LOGO/${UUID}\\.webp$`));
});

test('category folders; no date folders for records', () => {
  const now = new Date(Date.UTC(2026, 2, 5));
  assert.match(
    buildKey({ ...ctx, module: 'employee', entityId: 'EMP7', category: 'profile', mimeType: 'image/jpeg' }),
    new RegExp(`^Z001/B1/employee/EMP7/profile/${UUID}\\.jpg$`),
  );
  assert.match(
    buildKey({ ...ctx, module: 'invoice', entityId: 'INV9', mimeType: 'application/pdf', now }),
    new RegExp(`^Z001/B1/invoice/INV9/${UUID}\\.pdf$`),
  );
  assert.match(
    buildKey({ ...ctx, module: 'purchase', entityId: 'PUR1', category: 'bill', mimeType: 'application/pdf', now }),
    new RegExp(`^Z001/B1/purchase/PUR1/bill/${UUID}\\.pdf$`),
  );
});

test('rejects bad input', () => {
  const base = { ...ctx, module: 'expense', entityId: 'EXP1', mimeType: 'image/png' };
  assert.throws(() => buildKey({ ...base, module: 'salary' }), { status: 400 });
  assert.throws(() => buildKey({ ...base, mimeType: 'text/html' }), { status: 415 });
  assert.throws(() => buildKey({ ...base, module: 'branding', mimeType: 'application/pdf' }), { status: 415 });
  assert.throws(() => buildKey({ ...base, category: 'profile' }), { status: 400 });
  assert.throws(() => buildKey({ ...base, zoduId: '../Z002' }), { status: 400 });
  assert.throws(() => buildKey({ ...base, entityId: 'a/b' }), { status: 400 });
  // a branch called "_shared" would land in the tenant-wide area
  assert.throws(() => buildKey({ ...base, branchId: '_shared' }), { status: 400 });
});

test('ownership check: foreign keys are 404, never 403', () => {
  const own    = 'Z001/B1/expense/EXP1/x.png';
  const shared = 'Z001/_shared/branding/LOGO/x.png';
  assert.doesNotThrow(() => assertKeyBelongsTo(own, ctx));
  assert.doesNotThrow(() => assertKeyBelongsTo(shared, { zoduId: 'Z001', branchId: 'B2' }));
  assert.throws(() => assertKeyBelongsTo(own, { zoduId: 'Z002', branchId: 'B1' }), { status: 404 });
  assert.throws(() => assertKeyBelongsTo(own, { zoduId: 'Z001', branchId: 'B2' }), { status: 404 });
  assert.throws(() => assertKeyBelongsTo('Z001/B1/../../Z002/x', ctx), { status: 400 });
  // "Z0010" must not match the "Z001" prefix
  assert.throws(() => assertKeyBelongsTo('Z0010/B1/expense/E/x.png', ctx), { status: 404 });
  // tenant-only context reaches _shared but no branch
  assert.doesNotThrow(() => assertKeyBelongsTo(shared, { zoduId: 'Z001' }));
  assert.throws(() => assertKeyBelongsTo(own, { zoduId: 'Z001' }), { status: 404 });
});

test('entity prefix used for record cleanup', () => {
  assert.equal(entityPrefix({ ...ctx, module: 'purchase', entityId: 'PUR1' }), 'Z001/B1/purchase/PUR1/');
});
