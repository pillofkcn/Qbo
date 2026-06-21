import type { Client } from "discord.js";
import type { LavalinkManager, Player, Track } from "lavalink-client";
import { getGuildSettings } from "../db/settings.js";
import { altSearchSource } from "../lib/resolve.js";
import { logger } from "../logger.js";
import { clearNowPlaying, updateNowPlaying } from "../ui/controls.js";
import { errorEmbed } from "../ui/embeds.js";

const MAX_RETRIES = 2;

const retryKey = (id: string | undefined): string => `retry:${id ?? "unknown"}`;

/** Wire up all Lavalink player + node events (spec §9 src/lavalink/events.ts). */
export function registerLavalinkEvents(client: Client): void {
  const manager: LavalinkManager = client.lavalink;

  manager.on("playerCreate", (player) => {
    const settings = getGuildSettings(player.guildId);
    player.setData("autoplay_disabled", !settings.autoplay);
    logger.info({ guildId: player.guildId, autoplay: settings.autoplay }, "player created");
  });

  manager.on("trackStart", async (player, track) => {
    const t = track as Track;
    logger.info(
      { guildId: player.guildId, title: t?.info?.title, source: t?.info?.sourceName },
      "track start",
    );
    player.setData(retryKey(t?.info?.identifier), 0);
    await updateNowPlaying(client, player);
  });

  manager.on("trackEnd", (player, _track, payload) => {
    logger.debug(
      { guildId: player.guildId, reason: (payload as { reason?: string })?.reason },
      "track end",
    );
  });

  manager.on("queueEnd", async (player) => {
    logger.info({ guildId: player.guildId }, "queue ended");
    await clearNowPlaying(client, player);
  });

  manager.on("playerDestroy", async (player, reason) => {
    logger.info({ guildId: player.guildId, reason }, "player destroyed");
    await clearNowPlaying(client, player);
  });

  manager.on("playerDisconnect", async (player) => {
    await clearNowPlaying(client, player);
  });

  // ── Layer-3 fallback (spec §3): retry the failed track via another source ──
  manager.on("trackError", (player, track, payload) => {
    const p = payload as { exception?: { message?: string }; error?: string };
    const reason = p?.exception?.message ?? p?.error ?? "unknown error";
    void handlePlaybackFailure(client, player, track as Track, "trackError", reason);
  });

  manager.on("trackStuck", (player, track, payload) => {
    const p = payload as { thresholdMs?: number };
    void handlePlaybackFailure(client, player, track as Track, "trackStuck", `stuck >${p?.thresholdMs}ms`);
  });

  // ── Node lifecycle resilience (spec §12) — events are on nodeManager ──────
  manager.nodeManager.on("connect", (node) =>
    logger.info({ node: node.id }, "lavalink node connected"),
  );
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

/**
 * Re-resolve the failed track by text query, forcing a DIFFERENT source prefix
 * than the one that failed (e.g. YouTube -> SoundCloud). Bounded to MAX_RETRIES.
 * On success: play the recovered track immediately via play({ clientTrack }).
 * On exhaustion: notify the channel and let the queue continue.
 */
async function handlePlaybackFailure(
  client: Client,
  player: Player,
  track: Track | null,
  kind: "trackError" | "trackStuck",
  reason: string,
): Promise<void> {
  const info = track?.info;
  const attempts = (player.getData<number>(retryKey(info?.identifier)) ?? 0) + 1;
  player.setData(retryKey(info?.identifier), attempts);

  const fallbackSource = altSearchSource(info?.sourceName);

  // Structured fallback-hop log — this is how the owner diagnoses breakage.
  logger.warn(
    {
      guildId: player.guildId,
      event: kind,
      failedSource: info?.sourceName,
      title: info?.title,
      reason,
      attempt: attempts,
      maxRetries: MAX_RETRIES,
      fallbackSource,
    },
    "playback failure — attempting source fallback",
  );

  const query = `${info?.author ?? ""} ${info?.title ?? ""}`.trim();

  if (attempts > MAX_RETRIES || query === "") {
    logger.error(
      { guildId: player.guildId, title: info?.title },
      "fallback exhausted — skipping track",
    );
    await notify(client, player, `Couldn't play **${info?.title ?? "this track"}**, skipping.`);
    await advanceIfIdle(player);
    return;
  }

  const requester = (track as { requester?: unknown } | null)?.requester;
  const res = await player.search({ query, source: fallbackSource }, requester).catch(() => null);

  if (!res?.tracks?.length) {
    logger.error(
      { guildId: player.guildId, fallbackSource },
      "fallback re-resolve found nothing — skipping",
    );
    await notify(client, player, `Fallback source found no match for **${info?.title ?? "this track"}**, skipping.`);
    await advanceIfIdle(player);
    return;
  }

  const replacement = res.tracks[0];
  // Carry the attempt counter to the replacement so a second failure still counts.
  player.setData(retryKey(replacement.info.identifier), attempts);

  logger.info(
    {
      guildId: player.guildId,
      fallbackSource,
      recoveredFrom: info?.sourceName,
      recoveredVia: replacement.info.sourceName,
      title: replacement.info.title,
    },
    "fallback succeeded — playing recovered track",
  );

  await player.play({ clientTrack: replacement }).catch(async (err: unknown) => {
    logger.error({ err, guildId: player.guildId }, "failed to start recovered track");
    await advanceIfIdle(player);
  });
}

/** Start the next queued track only if the player is currently idle. */
async function advanceIfIdle(player: Player): Promise<void> {
  if (!player.playing && player.queue.tracks.length > 0) {
    await player.play().catch(() => {});
  }
}

async function notify(client: Client, player: Player, message: string): Promise<void> {
  const channelId = player.textChannelId;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased() && !channel.isDMBased()) {
    await channel.send({ embeds: [errorEmbed(message)] }).catch(() => {});
  }
}
