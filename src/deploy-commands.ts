import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { Command } from "./types/index.js";

/**
 * Registers slash commands with Discord.
 * - DEV_GUILD_ID set (one or more comma-separated guild IDs) -> registers to each
 *   guild instantly, and clears the global set so commands never appear twice.
 * - Blank -> registers globally (works on every server, can take up to ~1h to propagate).
 *
 * Run with: npm run deploy
 */
const here = dirname(fileURLToPath(import.meta.url)); // .../src

async function collectCommandData(): Promise<unknown[]> {
  const dir = join(here, "commands");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
  const body: unknown[] = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    const command: Command | undefined = mod.default ?? mod.command;
    if (command?.data) body.push(command.data.toJSON());
    else logger.warn({ file }, "command module has no `data`, skipping");
  }
  return body;
}

async function main(): Promise<void> {
  const body = await collectCommandData();
  const rest = new REST({ version: "10" }).setToken(config.discord.token);

  // DEV_GUILD_ID may be empty, one ID, or several comma-separated IDs. Guild
  // commands are INSTANT, so register to each listed guild; empty -> global.
  const guildIds = config.discord.devGuildId
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);

  if (guildIds.length === 0) {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
    logger.info(
      { count: body.length },
      "registered GLOBAL commands (may take up to ~1h to appear)",
    );
    return;
  }

  // Clear the global set first so it can't appear as duplicates of the per-guild commands.
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body: [] });
  for (const guildId of guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body });
      logger.info({ count: body.length, guild: guildId }, "registered guild commands (instant)");
    } catch (err) {
      logger.error(
        { err, guild: guildId },
        "failed to register commands for guild — is the bot invited to it?",
      );
    }
  }
}

main().catch((err) => {
  logger.error({ err }, "command deployment failed");
  process.exit(1);
});
