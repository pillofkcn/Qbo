import { SlashCommandBuilder } from "discord.js";
import { replyError, requirePlayer } from "../lib/guards.js";
import { nowPlayingEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show the currently playing track with a progress bar"),
  execute: async (interaction, client) => {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    if (!player.queue.current) {
      await replyError(interaction, "Nothing is playing right now.");
      return;
    }
    await interaction.reply({ embeds: [nowPlayingEmbed(player)] });
  },
};

export default command;
