const { PORT } = require('./config');
const { consumeEvents } = require('./consumer/consumer');
const expressApp = require('./express-app');
const { logger } = require('./utils/logger');
const fs = require('fs');
// const { consumeEvents } = require('./consumer/consumer');



const StartServer = async () => {
  expressApp.listen(PORT, () => {
    // consumeEvents();
    console.log("Server is running on port", PORT);
    logger.info(`App is listening to ${PORT}`);
  });

  process.on("uncaughtException", async (err) => {
    logger.error(err);
    process.exit(1);
  });
};

StartServer().then(() => {
  logger.info("server is up");
});


// consumeEvents().catch(err => {
//   console.error(err);
//   process.exit(1);
// });

module.exports = StartServer;

