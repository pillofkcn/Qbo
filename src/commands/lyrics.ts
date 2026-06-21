import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { truncate } from "../lib/format.js";
import { replyError, requirePlayer } from "../lib/guards.js";
import { logger } from "../logger.js";
import { ACCENT } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Show lyrics for the current track (via LavaLyrics / LRCLIB)"),
  execute: async (interaction, client) => {
    const player = await requirePlayer(interaction, client);
    if (!player) return;
    const current = player.queue.current;
    if (!current) {
      await replyError(interaction, "Nothing is playing right now.");
      return;
    }

    await interaction.deferReply();
    try {
      const lyrics = await player.getCurrentLyrics();
      const hasText = !!lyrics?.text && lyrics.text.trim().length > 0;
      const hasLines = !!lyrics?.lines && lyrics.lines.length > 0;
      if (!lyrics || (!hasText && !hasLines)) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(ACCENT)
              .setDescription(`😕 No lyrics found for **${truncate(current.info.title, 80)}**.`),
          ],
        });
        return;
      }

      const body = hasText ? lyrics.text! : lyrics.lines.map((l) => l.line).join("\n");
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle(`🎤 ${truncate(current.info.title, 100)}`)
            .setDescription(truncate(body, 4000))
            .setFooter({ text: `Source: ${lyrics.provider || lyrics.sourceName || "LavaLyrics"}` }),
        ],
      });
    } catch (err) {
      // getCurrentLyrics throws (RangeError) if the LavaLyrics plugin is missing.
      logger.warn({ err, guildId: interaction.guildId }, "lyrics fetch failed");
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setDescription(
              "⚠️ Lyrics aren't available — check that the **lavalyrics-plugin** (and a lyrics source like LRCLIB) is installed on Lavalink.",
            ),
        ],
      });
    }
  },
};

export default command;
