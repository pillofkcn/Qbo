import { SlashCommandBuilder } from "discord.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { updateNowPlaying } from "../ui/controls.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    if (player.paused) {
      await replyError(interaction, "Already paused.");
      return;
    }
    await player.pause();
    await updateNowPlaying(client, player);
    await interaction.reply({ embeds: [okEmbed("⏸️ Paused.")] });
  },
};

export default command;
