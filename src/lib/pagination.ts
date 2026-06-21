import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from "discord.js";

/**
 * Generic button paginator. The caller must have already deferred the reply.
 * customIds are namespaced `page:*` so the global interaction router ignores
 * them (they are handled by this collector, not the router).
 */
function navRow(index: number, total: number, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("page:first").setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(disabled || index === 0),
    new ButtonBuilder().setCustomId("page:prev").setEmoji("◀️").setStyle(ButtonStyle.Primary).setDisabled(disabled || index === 0),
    new ButtonBuilder().setCustomId("page:indicator").setLabel(`${index + 1}/${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId("page:next").setEmoji("▶️").setStyle(ButtonStyle.Primary).setDisabled(disabled || index === total - 1),
    new ButtonBuilder().setCustomId("page:last").setEmoji("⏭️").setStyle(ButtonStyle.Secondary).setDisabled(disabled || index === total - 1),
  );
}

export async function paginate(
  interaction: ChatInputCommandInteraction,
  pages: EmbedBuilder[],
  opts: { idleMs?: number } = {},
): Promise<void> {
  if (pages.length === 0) return;
  if (pages.length === 1) {
    await interaction.editReply({ embeds: [pages[0]] });
    return;
  }

  let index = 0;
  const message = await interaction.editReply({
    embeds: [pages[0]],
    components: [navRow(0, pages.length)],
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    idle: opts.idleMs ?? 120_000,
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: "These buttons aren't for you.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (i.customId === "page:first") index = 0;
    else if (i.customId === "page:prev") index = Math.max(0, index - 1);
    else if (i.customId === "page:next") index = Math.min(pages.length - 1, index + 1);
    else if (i.customId === "page:last") index = pages.length - 1;
    await i.update({ embeds: [pages[index]], components: [navRow(index, pages.length)] });
  });

  collector.on("end", async () => {
    await interaction
      .editReply({ components: [navRow(index, pages.length, true)] })
      .catch(() => {});
  });
}
