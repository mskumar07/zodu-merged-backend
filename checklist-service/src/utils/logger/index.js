const pinoHttp = require("pino-http");
const pino = require("pino");
const isDev = process.env.NODE_ENV !== "production";

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  base: { service: "restaurant-service" },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isDev
    ? {
        target: "pino-pretty", // pretty logs only in dev
        options: { colorize: true },
      }
    : undefined, // raw JSON logs in prod
});

const httpLogger = pinoHttp({
  level: "error",
  logger,
});

module.exports = { logger,httpLogger };
