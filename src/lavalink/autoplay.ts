import type { Player, Track, UnresolvedTrack } from "lavalink-client";
import { logger } from "../logger.js";

/**
 * Autoplay / radio (spec §1 nice-to-have). Runs when the queue empties; if it
 * adds tracks, playback continues seamlessly. Self-gates on the per-guild
 * "autoplay_disabled" flag (toggled by /autoplay). Strategy mirrors the
 * lavalink-client recommended pattern:
 *   - Spotify  -> `sprec` recommendations seeded by recent track ids
 *   - YouTube  -> the `RD<id>` radio-mix playlist of the last track
 *   - other    -> a YouTube Music search for the same artist/title
 */
export async function autoplayFunction(player: Player, lastTrack: Track | null): Promise<void> {
  if (player.getData<boolean>("autoplay_disabled") === true) return;
  if (!lastTrack?.info) return;

  const requester = (lastTrack as { requester?: unknown }).requester;
  const source = lastTrack.info.sourceName;

  try {
    if (source === "spotify") {
      const ids = [
        lastTrack.info.identifier,
        ...(player.queue.previous as Track[])
          .filter((t) => t.info.sourceName === "spotify")
          .map((t) => t.info.identifier),
      ].filter(Boolean);
      const seeds = [...new Set(ids)].slice(0, 5);
      if (seeds.length === 0) return;
      const res = await player
        .search({ query: `seed_tracks=${seeds.join(",")}`, source: "sprec" }, requester)
        .catch(() => null);
      await addRelated(player, res, lastTrack.info.identifier);
      return;
    }

    if (source === "youtube" || source === "youtubemusic") {
      const id = lastTrack.info.identifier;
      if (!id) return;
      const res = await player
        .search(
          { query: `https://www.youtube.com/watch?v=${id}&list=RD${id}`, source: "youtube" },
          requester,
        )
        .catch(() => null);
      await addRelated(player, res, id);
      return;
    }

    const res = await player
      .search(
        { query: `${lastTrack.info.author ?? ""} ${lastTrack.info.title}`.trim(), source: "ytmsearch" },
        requester,
      )
      .catch(() => null);
    await addRelated(player, res, lastTrack.info.identifier);
  } catch (err) {
    logger.warn({ err, guildId: player.guildId }, "autoplay failed");
  }
}

async function addRelated(
  player: Player,
  res: { tracks: (Track | UnresolvedTrack)[] } | null,
  excludeId?: string,
): Promise<void> {
  if (!res?.tracks?.length) return;
  const picks = res.tracks
    .filter((t) => t.info.identifier !== excludeId)
    .slice(0, 5);
  if (picks.length === 0) return;

  for (const t of picks) {
    const track = t as Track & { pluginInfo?: Record<string, unknown> };
    track.pluginInfo = {
      ...track.pluginInfo,
      clientData: { ...(track.pluginInfo?.clientData as object), fromAutoplay: true },
    };
  }
  await player.queue.add(picks);
  logger.info({ guildId: player.guildId, added: picks.length }, "autoplay queued related tracks");
}
