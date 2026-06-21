import { SlashCommandBuilder } from "discord.js";
import { requireActiveSameVC } from "../lib/guards.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue"),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    if (player.queue.tracks.length > 0) {
      await player.queue.splice(0, player.queue.tracks.length);
    }
    await player.skip(0, false).catch(() => {});
    await interaction.reply({ embeds: [okEmbed("⏹️ Stopped and cleared the queue.")] });
  },
};

export default command;
