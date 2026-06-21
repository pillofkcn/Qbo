import { pino } from "pino";
import { config } from "./config.js";

const isProd = process.env.NODE_ENV === "production";

/**
 * Structured logger. Pretty-printed in dev, plain JSON lines in production
 * (so the NSSM service log file stays grep-able). Every fallback hop is logged
 * with a stable shape so the owner can diagnose YouTube breakage (spec §12).
 */
export const logger = pino({
  level: config.bot.logLevel,
  base: undefined,
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});
