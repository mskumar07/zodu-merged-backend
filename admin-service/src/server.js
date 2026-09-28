const { PORT } = require('./config');
const expressApp = require('./express-app');
const { logger } = require('./utils/logger');
const { HandleUnCaughtException } = require('./utils/error/handler');

const StartServer = async () => {
  expressApp.listen(PORT, () => {
    console.log('Admin panel backend running on port', PORT);
    logger.info(`App is listening on ${PORT}`);
  });

  process.on('uncaughtException', HandleUnCaughtException);
};

StartServer();

module.exports = StartServer;
