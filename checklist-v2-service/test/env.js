// Per test file, before any module loads. Tests run against a real Postgres:
// TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD (or PGPASSWORD).
// global-setup.js creates the database fresh and applies every migration.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DB_HOSTNAME = process.env.TEST_DB_HOST || 'localhost';
process.env.DB_PORT = process.env.TEST_DB_PORT || '5432';
process.env.DB_USERNAME = process.env.TEST_DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || process.env.PGPASSWORD || 'postgres';
process.env.DB_NAME = 'checklist_v2_test';
process.env.DEFAULT_TIMEZONE = 'Asia/Kolkata';
process.env.REDIS_URL = '';
process.env.INTERNAL_TOKEN_AUTH = 'a'.repeat(40);
// The fake auth-service also answers employee-service's user → employee lookup.
process.env.EMPLOYEE_SERVICE_URL = process.env.AUTH_SERVICE_URL;
process.env.FILE_SERVICE_URL = 'http://127.0.0.1:9';   // never reached in these tests
