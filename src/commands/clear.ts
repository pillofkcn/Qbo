import { SlashCommandBuilder } from "discord.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear the queue (the current track keeps playing)"),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    const n = player.queue.tracks.length;
    if (n === 0) {
      await replyError(interaction, "The queue is already empty.");
      return;
    }
    await player.queue.splice(0, n);
    await interaction.reply({
      embeds: [okEmbed(`🧹 Cleared ${n} tracks from the queue (the current track keeps playing).`)],
    });
  },
};

export default command;
