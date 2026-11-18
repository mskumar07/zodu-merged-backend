// A fresh checklist_v2_test database with every migration, and a stand-in
// auth-service (keys + branch-access check) for the whole run.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

module.exports = async () => {
  require('./env');
  const conn = {
    host: process.env.DB_HOSTNAME, port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
  };
  const admin = new Client({ ...conn, database: 'postgres' });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS checklist_v2_test WITH (FORCE)');
  await admin.query('CREATE DATABASE checklist_v2_test');
  await admin.end();

  const db = new Client({ ...conn, database: 'checklist_v2_test' });
  await db.connect();
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => /^V\d+__.*\.sql$/.test(x)).sort()) {
    await db.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  await db.end();

  globalThis.__FAKE_AUTH__ = await require('@zodu/security/testing').startFakeAuth();
};
