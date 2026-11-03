const pinoHttp = require("pino-http");
const pino = require("pino");
const isDev = process.env.NODE_ENV !== "production";
// Pretty printing runs in a worker thread: not in tests.
const pretty = isDev && process.env.NODE_ENV !== "test";

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  base: { service: "auth-service" },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: pretty
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
