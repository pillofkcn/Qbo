import { SlashCommandBuilder } from "discord.js";
import { setDefaultVolume } from "../db/settings.js";
import { requireActiveSameVC } from "../lib/guards.js";
import { updateNowPlaying } from "../ui/controls.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the player volume (0–100)")
    .addIntegerOption((o) =>
      o
        .setName("level")
        .setDescription("Volume 0–100")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100),
    ),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    const level = interaction.options.getInteger("level", true);
    await player.setVolume(level);
    // Persist as the guild default for future players.
    setDefaultVolume(interaction.guildId!, level);
    await updateNowPlaying(client, player);
    await interaction.reply({ embeds: [okEmbed(`🔊 Volume set to ${level}%.`)] });
  },
};

export default command;
