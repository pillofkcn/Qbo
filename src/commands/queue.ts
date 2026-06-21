import { SlashCommandBuilder } from "discord.js";
import { requirePlayer } from "../lib/guards.js";
import { paginate } from "../lib/pagination.js";
import { buildQueueEmbeds } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the track queue (paginated)"),
  execute: async (interaction, client) => {
    await interaction.deferReply();
    const player = await requirePlayer(interaction, client);
    if (!player) return;

    const pages = buildQueueEmbeds(player);
    await paginate(interaction, pages);
  },
};

export default command;
