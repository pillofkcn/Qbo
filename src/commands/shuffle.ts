import { SlashCommandBuilder } from "discord.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { updateNowPlaying } from "../ui/controls.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue"),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    if (player.queue.tracks.length < 2) {
      await replyError(interaction, "Not enough tracks in the queue to shuffle.");
      return;
    }
    await player.queue.shuffle();
    await updateNowPlaying(client, player);
    await interaction.reply({ embeds: [okEmbed("🔀 Queue shuffled.")] });
  },
};

export default command;
