import { SlashCommandBuilder } from "discord.js";
import { cancelFallback } from "../lavalink/fallback.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("previous")
    .setDescription("Play the previous track from history"),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    const previous = await player.queue.shiftPrevious();
    if (!previous) {
      await replyError(interaction, "No previous track in history.");
      return;
    }
    cancelFallback(player);
    await player.play({ clientTrack: previous, position: 0 });
    await interaction.reply({ embeds: [okEmbed("⏮️ Playing the previous track.")] });
  },
};

export default command;
