import { Client, Collection, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { registerLavalinkEvents } from "./lavalink/events.js";
import { createLavalinkManager } from "./lavalink/manager.js";
import { loadCommands, loadEvents } from "./lib/loaders.js";
import { logger } from "./logger.js";

const client = new Client({
  // Guilds + GuildVoiceStates is all a slash-command music bot needs.
  // (No privileged MessageContent intent — commands are slash-only.)
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.commands = new Collection();
client.lavalink = createLavalinkManager(client);

// Forward raw voice gateway packets so lavalink-client can manage connections.
client.on("raw", (d) => {
  void client.lavalink.sendRawData(d);
});

registerLavalinkEvents(client);

async function main(): Promise<void> {
  await loadCommands(client);
  await loadEvents(client);
  await client.login(config.discord.token);
}

main().catch((err) => {
  logger.error({ err }, "fatal: bot failed to start");
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info({ sig }, "received shutdown signal, destroying client");
    void client.destroy();
    process.exit(0);
  });
}

process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException"));
