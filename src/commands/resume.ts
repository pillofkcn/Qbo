import { SlashCommandBuilder } from "discord.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { updateNowPlaying } from "../ui/controls.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    if (!player.paused) {
      await replyError(interaction, "Playback isn't paused.");
      return;
    }
    await player.resume();
    await updateNowPlaying(client, player);
    await interaction.reply({ embeds: [okEmbed("▶️ Resumed.")] });
  },
};

export default command;
