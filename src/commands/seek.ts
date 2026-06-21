import { SlashCommandBuilder } from "discord.js";
import { formatDuration, parseTimeToMs } from "../lib/format.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { updateNowPlaying } from "../ui/controls.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a position in the current track")
    .addStringOption((o) =>
      o.setName("time").setDescription("e.g. 1:30 or 90 (seconds)").setRequired(true),
    ),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    const current = player.queue.current;
    if (!current) {
      await replyError(interaction, "Nothing is playing right now.");
      return;
    }
    if (current.info.isStream || current.info.isSeekable === false) {
      await replyError(interaction, "This track can't be seeked.");
      return;
    }
    const ms = parseTimeToMs(interaction.options.getString("time", true));
    if (ms === null) {
      await replyError(interaction, "Invalid time. Use `mm:ss` or a number of seconds.");
      return;
    }
    const clamped = Math.min(ms, current.info.duration ?? ms);
    await player.seek(clamped);
    await updateNowPlaying(client, player);
    await interaction.reply({ embeds: [okEmbed(`⏩ Seeked to \`${formatDuration(clamped)}\`.`)] });
  },
};

export default command;
