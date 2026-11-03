// Builds a throwaway Postgres database for the tests from test/schema.sql plus
// the migrations newer than that snapshot, and checks Redis is reachable.
//
// Connection: TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD
// (CI), else the DB_* values of ./.env (local). Redis: TEST_REDIS_URL,
// default redis://localhost:6379/15.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const Redis = require('ioredis');
const dotenv = require('dotenv');

const NEWER_MIGRATIONS = ['auth_sessions_security_events.sql'];

function connection() {
  const file = path.join(__dirname, '..', '.env');
  const local = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
  return {
    host: process.env.TEST_DB_HOST || local.DB_HOSTNAME || 'localhost',
    port: Number(process.env.TEST_DB_PORT || local.DB_PORT || 5432),
    user: process.env.TEST_DB_USER || local.DB_USERNAME || 'postgres',
    password: process.env.TEST_DB_PASSWORD ?? local.DB_PASSWORD ?? 'postgres',
  };
}

module.exports = async () => {
  const conn = connection();
  if (!['localhost', '127.0.0.1', '::1', 'postgres'].includes(conn.host) && !process.env.TEST_DB_HOST) {
    throw new Error(`Refusing to create a test database on ${conn.host}: set TEST_DB_HOST explicitly`);
  }
  const database = process.env.TEST_DB_NAME || 'auth_service_test';

  const admin = new Client({ ...conn, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();

  const db = new Client({ ...conn, database });
  await db.connect();
  await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await db.end();

  // A fresh connection: the dump empties search_path for its own session.
  const migrate = new Client({ ...conn, database });
  await migrate.connect();
  for (const m of NEWER_MIGRATIONS) {
    await migrate.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', m), 'utf8'));
  }
  await migrate.end();

  const redisUrl = process.env.TEST_REDIS_URL || 'redis://localhost:6379/15';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  await redis.connect();
  await redis.flushdb();
  await redis.quit();

  process.env.__TEST_DB = JSON.stringify({ ...conn, database });
  process.env.__TEST_REDIS_URL = redisUrl;
};
