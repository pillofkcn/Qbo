import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type GuildTextBasedChannel,
} from "discord.js";
import type { Player } from "lavalink-client";
import { logger } from "../logger.js";
import { errorEmbed, nowPlayingEmbed } from "./embeds.js";

interface NowPlayingRef {
  channelId: string;
  messageId: string;
}

/** How often the now-playing message is re-edited so the progress bar advances. */
const NOW_PLAYING_TICK_MS = 2_000;
const tickers = new Map<string, ReturnType<typeof setInterval>>();

/** The two-row button control panel under the now-playing message (spec §10). */
export function nowPlayingButtons(player: Player): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("np:previous").setEmoji("⏮️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("np:pause")
      .setEmoji(player.paused ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("np:skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("np:stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("np:shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("np:loop")
      .setEmoji("🔁")
      .setStyle(player.repeatMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success),
  );
  return [row1, row2];
}

async function fetchTextChannel(
  client: Client,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel && channel.isTextBased() && !channel.isDMBased()) {
    return channel as GuildTextBasedChannel;
  }
  return null;
}

/**
 * Edit the single now-playing message in place (or post a fresh one). Keeping
 * ONE message per player avoids spamming the channel on every track change.
 */
export async function updateNowPlaying(client: Client, player: Player): Promise<void> {
  if (!player.queue.current) {
    await clearNowPlaying(client, player);
    return;
  }
  const channelId = player.textChannelId;
  if (!channelId) return;
  const channel = await fetchTextChannel(client, channelId);
  if (!channel) return;

  const payload = { embeds: [nowPlayingEmbed(player)], components: nowPlayingButtons(player) };
  const ref = player.getData<NowPlayingRef>("np");
  if (ref?.messageId && ref.channelId === channelId) {
    const edited = await channel.messages.edit(ref.messageId, payload).catch(() => null);
    if (edited) return;
  }
  const sent = await channel.send(payload).catch(() => null);
  if (sent) player.setData("np", { channelId, messageId: sent.id } satisfies NowPlayingRef);
}

/**
 * Live progress-bar updater: while a track is actively playing, re-edit the
 * now-playing message on an interval so the bar advances on its own. Skips edits
 * while paused/idle; cleared on stop/queueEnd/disconnect via clearNowPlaying.
 */
export function startNowPlayingTicker(client: Client, player: Player): void {
  stopNowPlayingTicker(player.guildId);
  const interval = setInterval(() => {
    const p = client.lavalink.getPlayer(player.guildId);
    if (!p || !p.queue.current || p.paused) return;
    void updateNowPlaying(client, p);
  }, NOW_PLAYING_TICK_MS);
  tickers.set(player.guildId, interval);
}

export function stopNowPlayingTicker(guildId: string): void {
  const t = tickers.get(guildId);
  if (t) {
    clearInterval(t);
    tickers.delete(guildId);
  }
}

/** Remove the now-playing message (on queueEnd / disconnect). */
export async function clearNowPlaying(client: Client, player: Player): Promise<void> {
  stopNowPlayingTicker(player.guildId);
  const ref = player.getData<NowPlayingRef>("np");
  if (!ref?.messageId) return;
  const channel = await fetchTextChannel(client, ref.channelId);
  if (channel) await channel.messages.delete(ref.messageId).catch(() => {});
  player.deleteData("np");
}

/** Handle a press on one of the now-playing control buttons. */
export async function handleNowPlayingButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  const guildId = interaction.guildId;
  const player = guildId ? client.lavalink.getPlayer(guildId) : undefined;
  if (!player || !player.queue.current) {
    await interaction.reply({
      embeds: [errorEmbed("Nothing is playing right now.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.member as GuildMember | null;
  const vcId = member?.voice?.channelId ?? null;
  if (!vcId || vcId !== player.voiceChannelId) {
    await interaction.reply({
      embeds: [errorEmbed("You must be in the same voice channel as the bot.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const action = interaction.customId.split(":")[1];
  // skip/previous/stop trigger trackStart/queueEnd, which refresh the message
  // via the events layer; pause/shuffle/loop need an explicit refresh here.
  const eventDriven = action === "skip" || action === "previous" || action === "stop";

  try {
    switch (action) {
      case "pause":
        if (player.paused) await player.resume();
        else await player.pause();
        break;
      case "skip":
        await player.skip(0, false);
        break;
      case "previous": {
        const prev = await player.queue.shiftPrevious();
        if (!prev) {
          await interaction.reply({
            embeds: [errorEmbed("No previous track.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await player.play({ clientTrack: prev });
        break;
      }
      case "stop":
        if (player.queue.tracks.length > 0) {
          await player.queue.splice(0, player.queue.tracks.length);
        }
        await player.skip(0, false).catch(() => {});
        break;
      case "shuffle":
        await player.queue.shuffle();
        break;
      case "loop": {
        const order = ["off", "track", "queue"] as const;
        const next = order[(order.indexOf(player.repeatMode) + 1) % order.length];
        await player.setRepeatMode(next);
        break;
      }
      default:
        break;
    }

    await interaction.deferUpdate().catch(() => {});
    if (!eventDriven) await updateNowPlaying(client, player);
  } catch (err) {
    logger.error({ err, action, guildId }, "now-playing button action failed");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate().catch(() => {});
    }
  }
}
