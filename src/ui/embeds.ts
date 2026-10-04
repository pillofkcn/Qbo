import { EmbedBuilder } from "discord.js";
import type { Player, Track, UnresolvedTrack } from "lavalink-client";
import { chunk, formatDuration, progressBar, truncate } from "../lib/format.js";
import { sourceLabel } from "../lib/resolve.js";

export type AnyTrack = Track | UnresolvedTrack;

export const ACCENT = 0x5865f2;
export const ERROR_COLOR = 0xed4245;
export const OK_COLOR = 0x57f287;
export const WARN_COLOR = 0xfee75c;

/** Render a requester (we store the discord.js User) as a mention. */
export function requesterMention(requester: unknown): string {
  const r = requester as { id?: string } | undefined;
  return r?.id ? `<@${r.id}>` : "—";
}

function artwork(track: AnyTrack): string | undefined {
  const info = track.info as { artworkUrl?: string | null };
  const plugin = (track as { pluginInfo?: { artworkUrl?: string | null } }).pluginInfo;
  return info.artworkUrl ?? plugin?.artworkUrl ?? undefined;
}

function loopLabel(mode: Player["repeatMode"]): string {
  if (mode === "track") return "🔂 Track";
  if (mode === "queue") return "🔁 Queue";
  return "➡️ Off";
}

/** One compact line describing a track, used in the queue list. */
function trackLine(track: AnyTrack): string {
  const { info } = track;
  const dur = info.isStream ? "🔴 LIVE" : formatDuration(info.duration ?? 0);
  const title = info.uri ? `[${truncate(info.title, 48)}](${info.uri})` : truncate(info.title, 48);
  return `${title} \`${dur}\` • ${requesterMention(track.requester)}`;
}

export const errorEmbed = (msg: string): EmbedBuilder =>
  new EmbedBuilder().setColor(ERROR_COLOR).setDescription(`❌ ${msg}`);

export const okEmbed = (msg: string): EmbedBuilder =>
  new EmbedBuilder().setColor(OK_COLOR).setDescription(`✅ ${msg}`);

export const infoEmbed = (msg: string): EmbedBuilder =>
  new EmbedBuilder().setColor(ACCENT).setDescription(msg);

/** Notice that a failed track continues from another source (Layer-3 fallback). */
export function fallbackEmbed(
  failed: { title: string; sourceName?: string },
  replacement: AnyTrack,
  resumedAtMs: number,
): EmbedBuilder {
  const from = sourceLabel(failed.sourceName);
  const via = sourceLabel(replacement.info.sourceName);
  const title = truncate(replacement.info.title, 80);
  const link = replacement.info.uri ? `[${title}](${replacement.info.uri})` : `**${title}**`;
  const at = resumedAtMs > 0 ? ` from \`${formatDuration(resumedAtMs)}\`` : "";
  return new EmbedBuilder()
    .setColor(WARN_COLOR)
    .setDescription(
      `⚠️ **${truncate(failed.title, 80)}** stopped on ${from.name} — playing ${link} via ${via.emoji} ${via.name}${at} instead.`,
    );
}

/** The now-playing embed (progress bar, source, requester, loop & volume). */
export function nowPlayingEmbed(player: Player): EmbedBuilder {
  const track = player.queue.current as Track | null;
  if (!track) {
    return new EmbedBuilder().setColor(ACCENT).setDescription("Nothing is playing right now.");
  }
  const { info } = track;
  const src = sourceLabel(info.sourceName);
  const position = player.position ?? 0;
  const progress = info.isStream
    ? "🔴 **LIVE**"
    : `${progressBar(position, info.duration)}\n\`${formatDuration(position)} / ${formatDuration(info.duration)}\``;

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setAuthor({ name: player.paused ? "⏸️ Paused" : "🎶 Now playing" })
    .setTitle(truncate(info.title, 100))
    .setURL(info.uri ?? null)
    .setDescription(progress)
    .addFields(
      { name: "Artist", value: truncate(info.author || "—", 40), inline: true },
      { name: "Source", value: `${src.emoji} ${src.name}`, inline: true },
      { name: "Requested by", value: requesterMention(track.requester), inline: true },
      { name: "Volume", value: `🔊 ${player.volume}%`, inline: true },
      { name: "Loop", value: loopLabel(player.repeatMode), inline: true },
      { name: "In queue", value: `📜 ${player.queue.tracks.length}`, inline: true },
    );

  const art = artwork(track);
  if (art) embed.setThumbnail(art);
  return embed;
}

/** Confirmation embed for a single track added to the queue. */
export function addedTrackEmbed(track: AnyTrack, position: number): EmbedBuilder {
  const { info } = track;
  const src = sourceLabel(info.sourceName);
  const embed = new EmbedBuilder()
    .setColor(OK_COLOR)
    .setAuthor({ name: "➕ Added to queue" })
    .setTitle(truncate(info.title, 100))
    .setURL(info.uri ?? null)
    .addFields(
      { name: "Artist", value: truncate(info.author || "—", 40), inline: true },
      { name: "Duration", value: info.isStream ? "🔴 LIVE" : formatDuration(info.duration ?? 0), inline: true },
      { name: "Position", value: position > 0 ? `#${position}` : "now playing", inline: true },
      { name: "Source", value: `${src.emoji} ${src.name}`, inline: true },
      { name: "Requested by", value: requesterMention(track.requester), inline: true },
    );
  const art = artwork(track);
  if (art) embed.setThumbnail(art);
  return embed;
}

/** Confirmation embed for a bulk-added playlist/album. */
export function addedPlaylistEmbed(
  name: string,
  tracks: AnyTrack[],
  requester: unknown,
): EmbedBuilder {
  const totalMs = tracks.reduce((sum, t) => sum + (t.info.duration ?? 0), 0);
  const preview = tracks
    .slice(0, 5)
    .map((t, i) => `\`${i + 1}.\` ${truncate(t.info.title, 50)}`)
    .join("\n");
  const more = tracks.length > 5 ? `\n…and ${tracks.length - 5} more` : "";
  return new EmbedBuilder()
    .setColor(OK_COLOR)
    .setAuthor({ name: "📚 Playlist added" })
    .setTitle(truncate(name || "Playlist", 100))
    .setDescription(`${preview}${more}`)
    .addFields(
      { name: "Tracks", value: `${tracks.length}`, inline: true },
      { name: "Total duration", value: formatDuration(totalMs), inline: true },
      { name: "Requested by", value: requesterMention(requester), inline: true },
    );
}

/** Build the paginated `/queue` embeds (10 per page) — spec §10. */
export function buildQueueEmbeds(player: Player, perPage = 10): EmbedBuilder[] {
  const current = player.queue.current as Track | null;
  const upcoming = player.queue.tracks as AnyTrack[];

  const remainingCurrent =
    current && !current.info.isStream
      ? Math.max((current.info.duration ?? 0) - (player.position ?? 0), 0)
      : 0;
  const totalRemaining =
    remainingCurrent + upcoming.reduce((sum, t) => sum + (t.info.duration ?? 0), 0);

  const currentBlock = current
    ? `**🎶 Now playing:**\n${trackLine(current)}\n\n`
    : "";

  if (upcoming.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle("📜 Queue")
        .setDescription(`${currentBlock}*No more tracks in the queue.*`)
        .setFooter({ text: `Loop: ${loopLabel(player.repeatMode)} • Volume ${player.volume}%` }),
    ];
  }

  const pages = chunk(upcoming, perPage);
  return pages.map((pageTracks, pi) => {
    const start = pi * perPage;
    const lines = pageTracks
      .map((t, i) => `\`${String(start + i + 1).padStart(2, " ")}.\` ${trackLine(t)}`)
      .join("\n");
    return new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle("📜 Queue")
      .setDescription(`${currentBlock}**Up next:**\n${lines}`)
      .setFooter({
        text:
          `Page ${pi + 1}/${pages.length} • ${upcoming.length} tracks • ` +
          `${formatDuration(totalRemaining)} remaining • Loop: ${loopLabel(player.repeatMode)}`,
      });
  });
}
