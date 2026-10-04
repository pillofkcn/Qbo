import { SlashCommandBuilder } from "discord.js";
import { cancelFallback } from "../lavalink/fallback.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("jump")
    .setDescription("Jump to a position in the queue (tracks in between are removed)")
    .addIntegerOption((o) =>
      o
        .setName("position")
        .setDescription("Queue position (1 = next track)")
        .setRequired(true)
        .setMinValue(1),
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
    cancelFallback(player);
    await player.skip(pos, false);
    await interaction.reply({
      embeds: [okEmbed(`⏭️ Jumped to #${pos} (tracks in between were removed from the queue).`)],
    });
  },
};

export default command;
