import { Events, MessageFlags } from "discord.js";
import { logger } from "../logger.js";
import { handleNowPlayingButton } from "../ui/controls.js";
import { errorEmbed } from "../ui/embeds.js";
import type { BotEvent } from "../types/index.js";

/**
 * Single router for both slash commands and component interactions.
 * - `np:*` buttons  -> now-playing control panel.
 * - `page:*` buttons and the play select menu are handled by their own
 *   short-lived collectors, so we deliberately ignore them here.
 */
const event: BotEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  execute: async (client, interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("np:")) {
        await handleNowPlayingButton(interaction, client);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({
        embeds: [errorEmbed("Unknown command.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await command.execute(interaction, client);
    } catch (err) {
      logger.error(
        { err, command: interaction.commandName, guildId: interaction.guildId },
        "command execution failed",
      );
      const payload = {
        embeds: [errorEmbed("An error occurred while running the command.")],
        flags: MessageFlags.Ephemeral as const,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};

export default event;
