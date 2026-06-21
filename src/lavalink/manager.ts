import type { Client } from "discord.js";
import { LavalinkManager, type SearchPlatform } from "lavalink-client";
import { config } from "../config.js";
import { autoplayFunction } from "./autoplay.js";

/**
 * Build the LavalinkManager. The node lives on the same host (localhost),
 * so no TLS is needed internally. `retryAmount` is high so the bot keeps
 * trying to reconnect if Lavalink restarts (spec §12 resilience).
 */
export function createLavalinkManager(client: Client): LavalinkManager {
  return new LavalinkManager({
    nodes: [
      {
        id: "main",
        host: config.lavalink.host,
        port: config.lavalink.port,
        authorization: config.lavalink.password,
        secure: config.lavalink.secure,
        retryAmount: 1000,
        retryDelay: 10_000,
      },
    ],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
    autoSkip: true,
    autoSkipOnResolveError: true,
    emitNewSongsOnly: true,
    client: {
      id: config.discord.clientId,
      username: "Qbo",
    },
    playerOptions: {
      defaultSearchPlatform: config.bot.defaultSearchPlatform as SearchPlatform,
      clientBasedPositionUpdateInterval: 150,
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
      onEmptyQueue: {
        // Auto-leave after the idle timeout when the queue is empty (spec §12).
        destroyAfterMs: config.bot.idleTimeoutMs,
        // Radio/autoplay; self-gates on the per-guild "autoplay_disabled" flag.
        autoPlayFunction: autoplayFunction,
      },
    },
    queueOptions: { maxPreviousTracks: 30 },
  });
}
