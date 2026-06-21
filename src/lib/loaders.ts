import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Collection, type Client } from "discord.js";
import { logger } from "../logger.js";
import type { BotEvent, Command } from "../types/index.js";

const here = dirname(fileURLToPath(import.meta.url)); // .../src/lib

function moduleFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
}

/** Read src/commands/* and register each into client.commands. */
export async function loadCommands(client: Client): Promise<Command[]> {
  if (!client.commands) client.commands = new Collection();
  const dir = join(here, "..", "commands");
  const loaded: Command[] = [];
  for (const file of moduleFiles(dir)) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    const command: Command | undefined = mod.default ?? mod.command;
    if (!command?.data || typeof command.execute !== "function") {
      logger.warn({ file }, "skipping invalid command module");
      continue;
    }
    client.commands.set(command.data.name, command);
    loaded.push(command);
  }
  logger.info({ count: loaded.length }, "commands loaded");
  return loaded;
}

/** Read src/events/* and bind each to the client emitter. */
export async function loadEvents(client: Client): Promise<void> {
  const dir = join(here, "..", "events");
  let count = 0;
  for (const file of moduleFiles(dir)) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    const event: BotEvent | undefined = mod.default ?? mod.event;
    if (!event?.name || typeof event.execute !== "function") {
      logger.warn({ file }, "skipping invalid event module");
      continue;
    }
    const handler = (...args: unknown[]) =>
      (event.execute as (client: Client, ...a: unknown[]) => unknown)(client, ...args);
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);
    count++;
  }
  logger.info({ count }, "events loaded");
}
