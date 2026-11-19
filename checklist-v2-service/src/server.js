// One image, two roles (§2): ROLE=api (HTTP + SSE + LISTEN) or ROLE=worker.
const { setServerTimeouts } = require('@zodu/security');
const config = require('./config');
const pool = require('./database/pool');
const listener = require('./database/listener');
const { logger } = require('./utils/logger');

let shuttingDown = false;
let stopRole = async () => {};

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal}: shutting down`);
  const force = setTimeout(() => process.exit(1), 40_000);
  force.unref();
  try {
    await stopRole();
    await pool.end();
  } catch (err) {
    logger.error('shutdown error', { error: err.message });
  }
  process.exit(0);
}

async function start() {
  if (config.ROLE === 'worker') {
    const { startWorker } = require('./worker');
    stopRole = startWorker();
  } else {
    const { createApiApp } = require('./api-app');
    const app = createApiApp();
    const hub = app.locals.hub;
    listener.on('notification', (p) => hub.onNotify(p));
    listener.on('resync', () => hub.resync());
    await listener.start();
    hub.start();
    const server = app.listen(config.PORT, () => logger.info(`✅ checklist-v2 api running on port ${config.PORT}`));
    setServerTimeouts(server);
    stopRole = async () => {
      server.close();             // stop accepting connections
      hub.closeAll();             // SSE: retry in 3 s, end streams
      await listener.stop();
    };
  }
  pool.query('SELECT 1')
    .then(() => logger.info('✅ checklist-v2 DB connected'))
    .catch((err) => logger.error('❌ checklist-v2 DB connection failed', { error: err.message }));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { error: reason?.stack || String(reason) });
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { error: err.stack });
  process.exit(1);
});

start();
