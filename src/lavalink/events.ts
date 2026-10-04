import type { Client } from "discord.js";
import {
  DestroyReasons,
  type LavalinkManager,
  type Player,
  type TrackEndEvent,
  type TrackExceptionEvent,
  type TrackStuckEvent,
} from "lavalink-client";
import { getGuildSettings } from "../db/settings.js";
import { logger } from "../logger.js";
import { clearNowPlaying, notify, startNowPlayingTicker, updateNowPlaying } from "../ui/controls.js";
import { errorEmbed } from "../ui/embeds.js";
import { handleTrackFinished, noteTrackStart, playedMs, recordFailure } from "./fallback.js";

/** Discord voice close code: "E2EE/DAVE protocol required". */
const DAVE_REQUIRED_CLOSE_CODE = 4017;

/** Player destroys the users should hear about (the bot leaves the channel). */
const DESTROY_NOTICES: Partial<Record<string, string>> = {
  [DestroyReasons.TrackErrorMaxTracksErroredPerTime]:
    "Stopped — too many tracks failed in a row. YouTube may be blocked; check the Lavalink log.",
  [DestroyReasons.TrackStuckMaxTracksErroredPerTime]:
    "Stopped — too many tracks got stuck in a row. Check the Lavalink log.",
  [DestroyReasons.LavalinkNoVoice]: "Lost the voice connection. Use /play to start again.",
};

/** Wire up all Lavalink player + node events (spec §9 src/lavalink/events.ts). */
export function registerLavalinkEvents(client: Client): void {
  const manager: LavalinkManager = client.lavalink;

  manager.on("playerCreate", (player) => {
    const settings = getGuildSettings(player.guildId);
    player.setData("autoplay_disabled", !settings.autoplay);
    logger.info({ guildId: player.guildId, autoplay: settings.autoplay }, "player created");
  });

  manager.on("trackStart", async (player, _track, payload) => {
    noteTrackStart(player, payload);
    const info = payload.track?.info;
    logger.info(
      { guildId: player.guildId, title: info?.title, source: info?.sourceName, identifier: info?.identifier },
      "track start",
    );
    await updateNowPlaying(client, player);
    startNowPlayingTicker(client, player);
  });

  manager.on("trackEnd", async (player, track, payload) => {
    logEnd("track end", player, payload);
    handleTrackFinished(client, player, track, payload);
  });

  manager.on("queueEnd", async (player, track, payload) => {
    logEnd("queue ended", player, payload);
    // While a replacement is being looked up, keep the now-playing panel.
    if (!handleTrackFinished(client, player, track, payload)) await clearNowPlaying(client, player);
  });

  manager.on("playerDestroy", async (player, reason) => {
    logger.info({ guildId: player.guildId, reason }, "player destroyed");
    const notice = reason ? DESTROY_NOTICES[reason] : undefined;
    if (notice) await notify(client, player, errorEmbed(notice));
    await clearNowPlaying(client, player);
  });

  manager.on("playerDisconnect", async (player, voiceChannelId) => {
    logger.info({ guildId: player.guildId, voiceChannelId }, "player disconnected from voice");
    await clearNowPlaying(client, player);
  });

  manager.on("playerSocketClosed", async (player, payload) => {
    const level = payload.code >= 4000 ? "warn" : "info";
    logger[level](
      {
        guildId: player.guildId,
        code: payload.code,
        reason: payload.reason,
        byRemote: payload.byRemote,
        voiceChannelId: player.voiceChannelId,
      },
      "discord voice websocket closed",
    );
    // Discord requires E2EE (DAVE) and Lavalink connected without it: nothing can be heard, and
    // Lavalink would keep "playing" into a dead connection. Say why and leave.
    if (payload.code === DAVE_REQUIRED_CLOSE_CODE) {
      await notify(
        client,
        player,
        errorEmbed(
          "Discord rejected the voice connection (E2EE/DAVE required): Lavalink couldn't load its DAVE " +
            "library. On Windows this is usually Smart App Control — see scripts/install-services.ps1.",
        ),
      );
      await player.destroy("DaveUnavailable").catch(() => {});
    }
  });

  // ── Layer-3 fallback (spec §3): record failures here, recover on the end event ──
  manager.on("trackError", async (player, track, payload) => {
    // lavalink-client also emits trackError with a plain Error when it can't resolve a track itself.
    if ((payload as { type?: unknown } | undefined)?.type !== "TrackExceptionEvent") {
      logger.error({ guildId: player.guildId, title: track?.info?.title, err: payload }, "track could not be resolved");
      return;
    }
    const info = payload.track?.info;
    const ex = payload.exception;
    logger.error(
      {
        guildId: player.guildId,
        title: info?.title,
        source: info?.sourceName,
        identifier: info?.identifier,
        positionMs: Math.round(playedMs(player, payload.track)),
        severity: ex?.severity,
        message: ex?.message ?? payload.error,
        cause: ex?.cause,
      },
      "track exception",
    );
    recordFailure(player, "error", payload, ex?.message ?? payload.error ?? "track exception");
  });

  manager.on("trackStuck", async (player, _track, payload) => {
    const info = payload.track?.info;
    logger.warn(
      {
        guildId: player.guildId,
        title: info?.title,
        source: info?.sourceName,
        thresholdMs: payload.thresholdMs,
        lastPositionMs: player.lastPosition,
      },
      "track stuck",
    );
    recordFailure(player, "stuck", payload, `stuck > ${payload.thresholdMs} ms`);
  });

  // Only emitted when advancedOptions.enableDebugEvents is on (LOG_LEVEL=debug).
  manager.on("debug", (key, data) => {
    logger.debug({ key, state: data.state, layer: data.functionLayer, err: data.error }, data.message);
  });

  // ── Node lifecycle resilience (spec §12) — events are on nodeManager ──────
  manager.nodeManager.on("connect", (node) => {
    // node.info (/v4/info) is fetched before "connect" fires — shows what the server really runs.
    const info = node.info;
    logger.info(
      {
        node: node.id,
        lavalink: info?.version?.semver,
        lavaplayer: info?.lavaplayer,
        jvm: info?.jvm,
        plugins: info?.plugins?.map((p) => `${p.name}@${p.version}`),
        sources: info?.sourceManagers,
      },
      "lavalink node connected",
    );
  });
  manager.nodeManager.on("reconnecting", (node) =>
    logger.warn({ node: node.id }, "lavalink node reconnecting"),
  );
  manager.nodeManager.on("disconnect", (node, reason) =>
    logger.warn({ node: node.id, reason }, "lavalink node disconnected"),
  );
  manager.nodeManager.on("error", (node, error) =>
    logger.error({ node: node.id, err: error }, "lavalink node error"),
  );
}

/** One info line per ended track — the position vs. duration shows premature ends at a glance. */
function logEnd(label: string, player: Player, payload: TrackEndEvent | TrackStuckEvent | TrackExceptionEvent): void {
  const info = payload.track?.info;
  logger.info(
    {
      guildId: player.guildId,
      event: payload.type,
      reason: payload.type === "TrackEndEvent" ? payload.reason : undefined,
      title: info?.title,
      source: info?.sourceName,
      identifier: info?.identifier,
      positionMs: Math.round(playedMs(player, payload.track)),
      durationMs: info?.length,
      queued: player.queue.tracks.length,
    },
    label,
  );
}
