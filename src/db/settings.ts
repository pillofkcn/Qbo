import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

/**
 * Tiny per-guild settings store (spec §1 nice-to-have).
 * One row per guild: default volume, default search platform, autoplay toggle.
 */

export interface GuildSettings {
  guildId: string;
  defaultVolume: number;
  searchPlatform: string;
  autoplay: boolean;
}

mkdirSync(dirname(config.bot.dbPath), { recursive: true });

const db = new Database(config.bot.dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guildId        TEXT PRIMARY KEY,
    defaultVolume  INTEGER,
    searchPlatform TEXT,
    autoplay       INTEGER NOT NULL DEFAULT 0
  );
`);

const selectStmt = db.prepare<[string]>(
  "SELECT guildId, defaultVolume, searchPlatform, autoplay FROM guild_settings WHERE guildId = ?",
);
const upsertStmt = db.prepare(`
  INSERT INTO guild_settings (guildId, defaultVolume, searchPlatform, autoplay)
  VALUES (@guildId, @defaultVolume, @searchPlatform, @autoplay)
  ON CONFLICT(guildId) DO UPDATE SET
    defaultVolume  = excluded.defaultVolume,
    searchPlatform = excluded.searchPlatform,
    autoplay       = excluded.autoplay
`);

interface Row {
  guildId: string;
  defaultVolume: number | null;
  searchPlatform: string | null;
  autoplay: number;
}

/** Read a guild's settings, falling back to the global defaults from config. */
export function getGuildSettings(guildId: string): GuildSettings {
  const row = selectStmt.get(guildId) as Row | undefined;
  return {
    guildId,
    defaultVolume: row?.defaultVolume ?? config.bot.defaultVolume,
    searchPlatform: row?.searchPlatform ?? config.bot.defaultSearchPlatform,
    autoplay: row ? row.autoplay === 1 : false,
  };
}

function save(s: GuildSettings): void {
  upsertStmt.run({
    guildId: s.guildId,
    defaultVolume: s.defaultVolume,
    searchPlatform: s.searchPlatform,
    autoplay: s.autoplay ? 1 : 0,
  });
}

export function setDefaultVolume(guildId: string, volume: number): void {
  const cur = getGuildSettings(guildId);
  save({ ...cur, defaultVolume: Math.min(Math.max(volume, 0), 100) });
}

export function setSearchPlatform(guildId: string, platform: string): void {
  const cur = getGuildSettings(guildId);
  save({ ...cur, searchPlatform: platform });
}

export function setAutoplay(guildId: string, enabled: boolean): void {
  const cur = getGuildSettings(guildId);
  save({ ...cur, autoplay: enabled });
}
