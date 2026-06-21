import "dotenv/config";

/**
 * Typed, validated environment configuration.
 * Required vars cause a clear, immediate exit if missing (fail fast — spec §12).
 */

const missing: string[] = [];

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    missing.push(name);
    return "";
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("CLIENT_ID"),
    devGuildId: optional("DEV_GUILD_ID"),
    ownerId: optional("OWNER_ID"),
  },
  lavalink: {
    host: optional("LAVALINK_HOST", "localhost"),
    port: optionalNumber("LAVALINK_PORT", 2333),
    password: required("LAVALINK_PASSWORD"),
    secure: optionalBool("LAVALINK_SECURE", false),
  },
  spotify: {
    clientId: required("SPOTIFY_CLIENT_ID"),
    clientSecret: required("SPOTIFY_CLIENT_SECRET"),
  },
  bot: {
    defaultVolume: Math.min(Math.max(optionalNumber("DEFAULT_VOLUME", 80), 0), 100),
    defaultSearchPlatform: optional("DEFAULT_SEARCH_PLATFORM", "ytmsearch"),
    idleTimeoutMs: optionalNumber("IDLE_TIMEOUT_MS", 5 * 60 * 1000),
    autoLeaveOnEmpty: optionalBool("AUTO_LEAVE_ON_EMPTY", true),
    logLevel: optional("LOG_LEVEL", "info"),
    dbPath: optional("DB_PATH", "data/settings.db"),
  },
} as const;

if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `\n[config] Missing required environment variable(s): ${missing.join(", ")}\n` +
      `         Copy .env.example to .env and fill these in, then restart.\n`,
  );
  process.exit(1);
}
