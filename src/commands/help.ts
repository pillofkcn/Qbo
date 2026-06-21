import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { ACCENT } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all commands the bot supports"),
  execute: async (interaction, client) => {
    const lines = [...client.commands.values()]
      .filter((c) => !c.guildOnly)
      .map((c) => ({ name: c.data.name, description: c.data.description }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `**/${c.name}** — ${c.description}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setAuthor({ name: "🎶 Queuebo — commands" })
      .setDescription(lines)
      .setFooter({ text: "Tip: type / in the chat to see these inline with autocomplete." });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;
