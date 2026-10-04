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
    // Emit trackStart for every start: replaying a song that just stopped must
    // re-post the now-playing panel and reset the fallback bookkeeping.
    emitNewSongsOnly: false,
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
      // lavalink-client destroys the player on the 4th track error/stall within 35 s.
      // One failed track plus its two fallback replacements fit; more than that is
      // an outage, so leaving (with a notice — see events.ts) is the right call.
      maxErrorsPerTime: { threshold: 35_000, maxAmount: 3 },
    },
    queueOptions: { maxPreviousTracks: 30 },
    advancedOptions: {
      // lavalink-client's internal "debug" events, logged by events.ts at LOG_LEVEL=debug.
      enableDebugEvents: config.bot.logLevel === "debug" || config.bot.logLevel === "trace",
    },
  });
}
