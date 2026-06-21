import {
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import type { SearchPlatform } from "lavalink-client";
import { getGuildSettings } from "../db/settings.js";
import { formatDuration, truncate } from "../lib/format.js";
import { requireUserInVoice } from "../lib/guards.js";
import { searchSourceFor } from "../lib/resolve.js";
import { logger } from "../logger.js";
import { addedPlaylistEmbed, addedTrackEmbed, errorEmbed, infoEmbed } from "../ui/embeds.js";
import type { Command } from "../types/index.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a track/playlist (YouTube or Spotify URL, or a search query)")
    .addStringOption((o) =>
      o
        .setName("query")
        .setDescription("A URL (YouTube/Spotify/SoundCloud) or text to search for")
        .setRequired(true),
    ),
  execute: async (interaction, client) => {
    await interaction.deferReply();
    const query = interaction.options.getString("query", true).trim();

    const vcId = await requireUserInVoice(interaction);
    if (!vcId) return;

    const guildId = interaction.guildId!;
    const settings = getGuildSettings(guildId);

    const existing = client.lavalink.getPlayer(guildId);
    if (existing && existing.voiceChannelId && existing.voiceChannelId !== vcId) {
      await interaction.editReply({ embeds: [errorEmbed("I'm already in another voice channel.")] });
      return;
    }

    const player =
      existing ??
      client.lavalink.createPlayer({
        guildId,
        voiceChannelId: vcId,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: settings.defaultVolume,
      });
    if (!player.connected) await player.connect();

    const source = searchSourceFor(query, settings.searchPlatform as SearchPlatform);
    const result = await player
      .search({ query, source }, interaction.user)
      .catch((err) => {
        logger.error({ err, query }, "search failed");
        return null;
      });

    if (!result || result.loadType === "error") {
      await interaction.editReply({
        embeds: [errorEmbed("Search failed. Try again or use a different link.")],
      });
      return;
    }
    if (result.loadType === "empty" || result.tracks.length === 0) {
      await interaction.editReply({
        embeds: [errorEmbed(`No results for **${truncate(query, 80)}**.`)],
      });
      return;
    }

    const startIfIdle = async () => {
      if (!player.playing && !player.paused) await player.play();
    };

    // Playlist / album -> bulk add.
    if (result.loadType === "playlist") {
      await player.queue.add(result.tracks);
      const name =
        (result.playlist as { title?: string; name?: string } | null)?.title ??
        (result.playlist as { name?: string } | null)?.name ??
        "Playlist";
      await interaction.editReply({
        embeds: [addedPlaylistEmbed(name, result.tracks, interaction.user)],
      });
      await startIfIdle();
      return;
    }

    // Direct track / single URL.
    if (result.loadType === "track") {
      const track = result.tracks[0];
      const wasIdle = !player.playing && !player.queue.current;
      await player.queue.add(track);
      await interaction.editReply({
        embeds: [addedTrackEmbed(track, wasIdle ? 0 : player.queue.tracks.length)],
      });
      await startIfIdle();
      return;
    }

    // Search results -> top-5 select menu (spec §10 chosen UX).
    const top = result.tracks.slice(0, 5);
    const menu = new StringSelectMenuBuilder()
      .setCustomId("play:select")
      .setPlaceholder("Pick a track…")
      .addOptions(
        top.map((t, i) => ({
          label: truncate(t.info.title || `Result ${i + 1}`, 90),
          description: truncate(
            `${t.info.author ?? "—"} • ${t.info.isStream ? "LIVE" : formatDuration(t.info.duration ?? 0)}`,
            90,
          ),
          value: String(i),
        })),
      );

    const message = await interaction.editReply({
      embeds: [infoEmbed(`🔎 Results for **${truncate(query, 80)}** — pick one:`)],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 30_000,
      max: 1,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: "This selection isn't for you.", flags: MessageFlags.Ephemeral });
        return;
      }
      const track = top[Number(i.values[0])];
      const wasIdle = !player.playing && !player.queue.current;
      await player.queue.add(track);
      await i.update({
        embeds: [addedTrackEmbed(track, wasIdle ? 0 : player.queue.tracks.length)],
        components: [],
      });
      await startIfIdle();
    });

    collector.on("end", async (collected) => {
      if (collected.size === 0) {
        await interaction
          .editReply({ embeds: [infoEmbed("⌛ Selection timed out.")], components: [] })
          .catch(() => {});
      }
    });
  },
};

export default command;
