const { PORT } = require('./config');
const { setServerTimeouts } = require('@zodu/security');
const { initAuth } = require('./auth');
const expressApp = require('./express-app');
const { logger } = require('./utils/logger');
// const { consumeEvents } = require('./consumer/consumer');

const StartServer = async () => {
  // Signing keys, Redis and the password hasher must be ready before the first request.
  await initAuth();
  const server = expressApp.listen(PORT, () => {
    // consumeEvents();
    logger.info(`App is listening to ${PORT}`);
  });
  setServerTimeouts(server);

  process.on("uncaughtException", async (err) => {
    logger.error(err);
    process.exit(1);
  });
};

StartServer().then(
  () => logger.info("server is up"),
  (err) => {
    logger.fatal({ err: err.message }, 'auth-service failed to start');
    process.exit(1);
  },
);

module.exports = StartServer;
