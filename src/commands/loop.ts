import { SlashCommandBuilder } from "discord.js";
import { requireActiveSameVC } from "../lib/guards.js";
import { updateNowPlaying } from "../ui/controls.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const LABELS: Record<string, string> = {
  off: "➡️ Off",
  track: "🔂 Repeat track",
  queue: "🔁 Repeat queue",
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set the repeat mode")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("off | track | queue")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Track", value: "track" },
          { name: "Queue", value: "queue" },
        ),
    ),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    const mode = interaction.options.getString("mode", true) as "off" | "track" | "queue";
    await player.setRepeatMode(mode);
    await updateNowPlaying(client, player);
    await interaction.reply({ embeds: [okEmbed(`Loop set: ${LABELS[mode]}`)] });
  },
};

export default command;
