import { SlashCommandBuilder } from "discord.js";
import { cancelFallback } from "../lavalink/fallback.js";
import { replyError, requireActiveSameVC } from "../lib/guards.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current track (or several at once)")
    .addIntegerOption((o) =>
      o.setName("count").setDescription("How many tracks to skip (default 1)").setMinValue(1),
    ),
  execute: async (interaction, client) => {
    const player = await requireActiveSameVC(interaction, client);
    if (!player) return;
    if (!player.queue.current) {
      await replyError(interaction, "Nothing is playing right now.");
      return;
    }
    const requested = interaction.options.getInteger("count") ?? 1;
    const count = Math.min(requested, player.queue.tracks.length + 1);
    const hadMore = player.queue.tracks.length > 0;
    cancelFallback(player);
    await player.skip(count, false).catch(() => {});
    await interaction.reply({
      embeds: [
        okEmbed(
          hadMore
            ? `⏭️ Skipped${requested > 1 ? ` (${count})` : ""}.`
            : "⏹️ Skipped — end of queue.",
        ),
      ],
    });
  },
};

export default command;
