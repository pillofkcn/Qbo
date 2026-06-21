import { SlashCommandBuilder } from "discord.js";
import { requireActiveSameVC } from "../lib/guards.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Disconnect the bot from the voice channel and clear state"),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    await player.destroy("disconnect command");
    await interaction.reply({ embeds: [okEmbed("👋 Disconnected. See you!")] });
  },
};

export default command;
