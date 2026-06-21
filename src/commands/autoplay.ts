import { SlashCommandBuilder } from "discord.js";
import { setAutoplay } from "../db/settings.js";
import { replyError } from "../lib/guards.js";
import { okEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Toggle autoplay (radio — adds related tracks when the queue empties)")
    .addStringOption((o) =>
      o
        .setName("state")
        .setDescription("on | off")
        .setRequired(true)
        .addChoices({ name: "On", value: "on" }, { name: "Off", value: "off" }),
    ),
  execute: async (interaction, client) => {
    if (!interaction.inGuild()) {
      await replyError(interaction, "This command only works in a server.");
      return;
    }
    const guildId = interaction.guildId!;
    const on = interaction.options.getString("state", true) === "on";
    setAutoplay(guildId, on);
    // Apply immediately to the live player, if any.
    client.lavalink.getPlayer(guildId)?.setData("autoplay_disabled", !on);
    await interaction.reply({
      embeds: [
        okEmbed(
          on
            ? "📻 Autoplay enabled — I'll add related tracks when the queue empties."
            : "⏹️ Autoplay disabled.",
        ),
      ],
    });
  },
};

export default command;
