const { PORT }  = require('./config');
const app        = require('./express-app');
const { logger } = require('./utils/logger');

const StartServer = async () => {
  app.listen(PORT, () => {
    logger.info(`✅ Checklist service running on port ${PORT}`);
  });

  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection:', reason);
    process.exit(1);
  });
};

StartServer();

module.exports = StartServer;
