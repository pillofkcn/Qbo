import { SlashCommandBuilder } from "discord.js";
import type { Track, UnresolvedTrack } from "lavalink-client";
import { truncate } from "../lib/format.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove one track from the queue by position")
    .addIntegerOption((o) =>
      o.setName("position").setDescription("Queue position").setRequired(true).setMinValue(1),
    ),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    const len = player.queue.tracks.length;
    if (len === 0) {
      await replyError(interaction, "The queue is empty.");
      return;
    }
    const pos = interaction.options.getInteger("position", true);
    if (pos > len) {
      await replyError(interaction, `Enter a position between 1 and ${len}.`);
      return;
    }
    const removed = await player.queue.splice(pos - 1, 1);
    const track = (Array.isArray(removed) ? removed[0] : removed) as
      | Track
      | UnresolvedTrack
      | undefined;
    await interaction.reply({
      embeds: [okEmbed(`🗑️ Removed from the queue: **${truncate(track?.info?.title ?? `#${pos}`, 80)}**`)],
    });
  },
};

export default command;
