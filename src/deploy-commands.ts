import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { Command } from "./types/index.js";

/**
 * Registers slash commands with Discord.
 * - If DEV_GUILD_ID is set -> registers to that guild (appears instantly).
 * - Otherwise -> registers globally (can take up to ~1h to propagate).
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

  if (config.discord.devGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId),
      { body },
    );
    logger.info(
      { count: body.length, guild: config.discord.devGuildId },
      "registered guild commands (instant)",
    );
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
    logger.info(
      { count: body.length },
      "registered GLOBAL commands (may take up to ~1h to appear)",
    );
  }
}

main().catch((err) => {
  logger.error({ err }, "command deployment failed");
  process.exit(1);
});
