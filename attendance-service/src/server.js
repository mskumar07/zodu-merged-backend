const { PORT } = require('./config');
const expressApp = require('./express-app');
const { logger } = require('./utils/logger');

const StartServer = async () => {
  expressApp.listen(PORT, () => {
    logger.info(`App is listening to ${PORT}`);
  });

  process.on('uncaughtException', async (err) => {
    logger.error(err);
    process.exit(1);
  });
};

StartServer().then(() => {
  logger.info('server is up');
});

module.exports = StartServer;
