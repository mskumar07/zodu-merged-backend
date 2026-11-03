// Phase 2 smoke test: the services' real file code against an in-process
// file-service (in-memory storage), with each service's DB modules stubbed.
// Needs every service's own npm install (pg, express, ...):  npm run test:services
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

const REPO = path.resolve(__dirname, '../../..');
const { makeApp, INTERNAL_TOKEN, PNG, pdf, USERS } = require('../helpers');
const request = require('supertest');

let fs;
let server;
test.before(async () => {
  fs = makeApp();
  server = fs.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  Object.assign(process.env, {
    FILE_SERVICE_URL: `http://127.0.0.1:${server.address().port}`,
    INTERNAL_TOKEN: INTERNAL_TOKEN,
    NODE_ENV: 'production',
  });
});
test.after(() => server.close());

const mf = (buffer, originalname, mimetype = 'application/octet-stream') => ({ buffer, originalname, mimetype, size: buffer.length });

// Pre-load a fake module in place of a real one (DB pools, repositories).
function stub(file, exportsObj) {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj };
}

const flush = () => new Promise((r) => setTimeout(r, 150));

for (const shop of ['retail', 'restaurant']) {
  test(`${shop}: /upload staging, attachments claimed on save, removed on delete, images claimed`, async () => {
    const src = `${REPO}/${shop}-service/src`;
    const service = require(`${src}/services/${shop}-service.js`);
    const attachments = require(`${src}/utils/attachments.js`);
    const files = require(`${src}/utils/file-client.js`);

    const one = await service.uploadImg(mf(PNG, 'bill.png', 'image/png'), { clientIp: '203.0.113.5' });
    assert.equal(one.success, true);
    assert.match(one.fileUrl, /\/files\/v\/[0-9a-f-]{36}\?exp=\d+&sig=[\w-]{43}$/);
    const bad = await service.uploadImg(mf(Buffer.from('<svg/>'), 'x.svg'), {});
    assert.equal(bad.success, false);

    // 12 files → two file-service calls, one list
    const many = await service.uploadMultiple(Array.from({ length: 12 }, (_, i) => mf(PNG, `p${i}.png`, 'image/png')), {});
    assert.equal(many.length, 12);
    assert.deepEqual(Object.keys(many[0]).sort(), ['filename', 'id', 'mimetype', 'size', 'url']);
    // a bad file in the second chunk discards the first chunk too
    const before = [...fs.repo.rows.values()].filter((r) => r.status === 'ready').length;
    await assert.rejects(service.uploadMultiple([
      ...Array.from({ length: 10 }, (_, i) => mf(PNG, `q${i}.png`, 'image/png')), mf(PNG, 'evil.pdf'),
    ], {}));
    assert.equal([...fs.repo.rows.values()].filter((r) => r.status === 'ready').length, before);

    // discard an unclaimed upload by its id (DELETE /delete/file/:name)
    assert.equal((await service.deleteFileFromMinIO(many[11].id, {})).success, true);
    assert.equal(fs.repo.rows.get(many[11].id).status, 'deleted');
    assert.equal((await service.deleteFileFromMinIO('1712-old.webp', {})).success, true);

    // saving an expense: the client sends what /upload/multiple returned, plus an old URL
    const legacy = { id: 'x', filename: 'old.pdf', url: 'https://api.myzodu.com/retail/file/1712-old.pdf' };
    const data = { zodu_id: 'Z001', branch_id: 'B1', attachment_url: [many[0], many[1], legacy] };
    const db = { query: async () => { throw new Error('no lookup expected'); } };
    const stored = await attachments.storedAttachments(db, { table: 'tbl_expense', idColumn: 'expense_id', id: 'EXP/24-25/7', data, module: 'expense' });
    assert.equal(stored.length, 3);
    assert.equal(stored[0].file_id, many[0].id);
    assert.equal(stored[0].url, undefined);
    assert.deepEqual(stored[2], legacy);
    const row = fs.repo.rows.get(many[0].id);
    assert.deepEqual([row.zodu_id, row.branch_id, row.module, row.entity_id], ['Z001', 'B1', 'expense', 'EXP_24-25_7']);
    assert.equal((await request(fs.app).get(`/v/${many[0].id}`)).status, 404, 'private after the claim');

    // purchase / expense ids come from a database trigger: the files are claimed
    // after the INSERT, under the generated id (never purchase/undefined/)
    const gen = await service.uploadMultiple([mf(PNG, 'gen.png', 'image/png')], {});
    const genDb = { query: async (_sql, params) => ({ rows: [{ purchase_id: params[1], zodu_id: params[2], branch_id: 'B1', attachment_url: params[0] }] }) };
    const inserted = { purchase_id: 'PUR-B1-007', zodu_id: 'Z001', branch_id: 'B1', attachment_url: null };
    const saved = await attachments.storeAfterInsert(genDb, { table: 'tbl_purchase', idColumn: 'purchase_id', row: inserted, attachments: gen, module: 'purchase' });
    assert.match(fs.repo.rows.get(gen[0].id).object_key, /^Z001\/B1\/purchase\/PUR-B1-007\/[0-9a-f-]{36}\.png$/);
    assert.equal(JSON.parse(saved.attachment_url)[0].file_id, gen[0].id);
    const noId = await service.uploadMultiple([mf(PNG, 'noid.png', 'image/png')], {});
    const kept = await attachments.storedAttachments(db, { table: 'tbl_purchase', idColumn: 'purchase_id', id: undefined, data: { zodu_id: 'Z001', branch_id: 'B1', attachment_url: noId }, module: 'purchase' });
    assert.deepEqual(kept, noId, 'no id: kept as sent, not claimed');
    assert.equal(fs.repo.rows.get(noId[0].id).module, 'uploads');

    // edit without zodu_id: tenant read from the row; resaving the shown response keeps the files
    const shown = await files.fileUrls(stored);
    assert.match(shown[0].url, /X-Amz-Expires=900/);
    const lookupDb = { query: async () => ({ rows: [{ zodu_id: 'Z001', branch_id: 'B1' }] }) };
    const again = await attachments.storedAttachments(lookupDb, {
      table: 'tbl_expense', idColumn: 'expense_id', id: 'EXP/24-25/7', data: { attachment_url: shown }, module: 'expense',
    });
    assert.deepEqual(again.map((e) => e.file_id), stored.map((e) => e.file_id));
    assert.match(shown[2].url, /\?exp=\d+&sig=/);
    assert.deepEqual(again[2], legacy, 'the old URL is stored without its signature');
    // ambiguous id across companies: left as sent
    const twoRows = { query: async () => ({ rows: [{}, {}] }) };
    const asSent = await attachments.storedAttachments(twoRows, {
      table: 'tbl_expense', idColumn: 'expense_id', id: 'E1', data: { attachment_url: [many[2]] }, module: 'expense',
    });
    assert.deepEqual(asSent, [many[2]]);

    // the response middleware fills fresh URLs into the old shape
    const app = express();
    app.use(files.fileUrlsMiddleware);
    app.get('/e', (_req, res) => res.json({ data: [{ expense_id: 'E', attachment_url: stored }] }));
    const res = await request(app).get('/e');
    const att = res.body.data[0].attachment_url;
    assert.match(att[0].url, /X-Amz-Expires=900/);
    assert.equal(att[0].filename, 'p0.png');
    assert.equal(att[0].file_ctx, undefined);
    // the old URL goes out signed; saving it back stores it like before (re-signed on every read)
    assert.equal(att[2].url.split('?')[0], legacy.url);
    assert.match(att[2].url, /\?exp=\d+&sig=[\w-]{43}$/);

    // deleting the record soft-deletes its files, old entries untouched
    await attachments.removeStored(stored);
    assert.equal(fs.repo.rows.get(many[0].id).status, 'deleted');

    // item / menu image: claimed in the background, link unchanged
    attachments.claimImage({ zodu_id: 'Z001', branch_id: 'B1', item_uuid: 'IT1', menu_id: 'M1', item_img: one.fileUrl, menu_image: one.fileUrl },
      { field: shop === 'retail' ? 'item_img' : 'menu_image', idField: shop === 'retail' ? 'item_uuid' : 'menu_id' });
    await flush();
    const img = fs.repo.rows.get(files.fileIdFromUrl(one.fileUrl));
    assert.equal(img.module, 'menu-items');
    assert.match(img.object_key, /^Z001\/B1\/menu-items\/[0-9a-f-]{36}\.webp$/, 'no folder per item');
    assert.equal((await request(fs.app).get(`/v/${img.file_id}${new URL(one.fileUrl).search}`)).status, 200);
    assert.equal((await request(fs.app).get(`/v/${img.file_id}`)).status, 404, 'not without the signature');
  });
}

test('employee: document upload stores file_id, responses carry fresh URLs, delete removes', async () => {
  const src = `${REPO}/employee-service/src`;
  const docs = [];
  stub(`${src}/database/connection.js`, { connect: async () => ({ query: async () => ({}), release() {} }) });
  stub(`${src}/repository/employee-repo.js`, {
    findById: async () => ({ employee_id: 'EMP1' }),
    insertDocument: async (_c, d) => { const row = { id: docs.length + 1, ...d, file_url: null }; docs.push(row); return row; },
    deleteDocument: async (id) => docs.find((d) => d.id === Number(id)),
  });
  const service = require(`${src}/services/employee-service.js`);
  const files = require(`${src}/utils/file-client.js`);
  const ctx = { zoduId: 'Z001', branchId: 'B1', userId: USERS.admin };

  const out = await service.uploadDocument('EMP1', { zodu_id: 'Z001', branch_id: 'B1', document_type: 'PAN Card', file: mf(pdf(), 'pan.pdf', 'application/pdf') }, 'u', ctx);
  const fileId = docs[0].file_id;
  assert.equal(fs.repo.rows.get(fileId).category, 'documents');
  const resolved = await files.fileUrls(out);
  assert.match(resolved.data.file_url, /X-Amz-Expires=900/);
  assert.equal(resolved.data.file_ctx, undefined);

  await service.uploadDocument('EMP1', { zodu_id: 'Z001', branch_id: 'B1', document_type: 'Profile Photo', file: mf(PNG, 'me.png', 'image/png') }, 'u', ctx);
  assert.equal(fs.repo.rows.get(docs[1].file_id).category, 'profile');

  // profile_photo_url as the SQL builds it
  const list = await files.fileUrls([{ profile_photo_url: { file_id: docs[1].file_id, file_ctx: 'Z001/B1', as_string: true } }, { profile_photo_url: 'https://old/employee/file/x.webp' }]);
  assert.match(list[0].profile_photo_url, /X-Amz-Expires=900/);
  assert.match(list[1].profile_photo_url, /^https:\/\/old\/employee\/file\/x\.webp\?exp=\d+&sig=/);

  await assert.rejects(
    service.uploadDocument('EMP1', { zodu_id: 'Z001', branch_id: 'B1', document_type: 'x', file: mf(PNG, 'a.pdf', 'application/pdf') }, 'u', ctx),
    { status: 415 },
  );

  await service.deleteDocument('1', 'EMP1', { zodu_id: 'Z001', branch_id: 'B1' }, ctx);
  assert.equal(fs.repo.rows.get(fileId).status, 'deleted');
});

test('checklist: attachments upload, edit keeps stored files, delete removes', async () => {
  const src = `${REPO}/checklist-service/src`;
  let stored = [];
  stub(`${src}/database/connection.js`, { connect: async () => ({ query: async () => ({}), release() {} }) });
  stub(`${src}/repository/checklist-repo.js`, {
    findById: async () => ({ id: 'c1' }),
    insertAttachments: async (_c, { files: f, file_ctx, uploaded_by, uploaded_by_name }) => {
      stored = [...stored, ...f.map((x, i) => ({ id: `a${stored.length + i}`, file_name: x.original_name, file_id: x.file_id, file_ctx, url_key: 'file_url', uploaded_by, uploaded_by_name }))];
      return { file_url: stored };
    },
    findAttachments: async () => stored,
    updateChecklist: async () => ({ id: 'c1' }),
    findAssignees: async () => [],
    updateAttachments: async (_c, _id, a) => { stored = a; return stored; },
    deleteAttachment: async (entryId) => { stored = stored.filter((a) => a.id !== entryId); return { file_url: stored }; },
    deleteChecklist: async () => true,
  });
  const service = require(`${src}/services/checklist-service.js`);
  const files = require(`${src}/utils/file-client.js`);
  const id = '9b2f6a64-0000-4000-8000-000000000001';

  await service.uploadAttachments(id, [mf(PNG, 'a.png', 'image/png'), mf(pdf(), 'b.pdf', 'application/pdf')],
    { zodu_id: 'Z001', branch_id: 'B1', employee_id: 'e', employee_name: 'E' }, {});
  assert.equal(stored.length, 2);
  assert.match(fs.repo.rows.get(stored[0].file_id).object_key, new RegExp(`^Z001/B1/checklist/${id}/attachments/`));

  // the client edits: sends back the shown entries (expiring URL) minus the second one
  const shown = await files.fileUrls(stored);
  const keep = { ...shown[0], file_name: 'renamed.png' };
  delete keep.file_id;   // the update schema strips it
  const dropped = stored[1].file_id;
  await service.updateChecklist(id, { zodu_id: 'Z001', branch_id: 'B1', attachments: [keep] });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].file_name, 'renamed.png');
  assert.equal(stored[0].file_url, undefined, 'the shown URL is not stored');
  assert.ok(files.isFileId(stored[0].file_id));
  assert.equal(fs.repo.rows.get(dropped).status, 'deleted');

  await service.deleteAttachment(id, stored[0].id, { zodu_id: 'Z001', branch_id: 'B1' });
  assert.equal(stored.length, 0);
  assert.equal([...fs.repo.rows.values()].filter((r) => r.module === 'checklist' && r.status === 'ready').length, 0);
});
