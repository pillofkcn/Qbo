import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
} from "discord.js";
import type { Player } from "lavalink-client";
import { errorEmbed } from "../ui/embeds.js";

/** The voice channel id of the member who ran the command (or null). */
export function memberVoiceChannelId(interaction: ChatInputCommandInteraction): string | null {
  const member = interaction.member as GuildMember | null;
  return member?.voice?.channelId ?? null;
}

/** Reply with an error embed, ephemeral, whether or not the reply was deferred. */
export async function replyError(
  interaction: ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  const payload = { embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral as const };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

/** Require the command to be run in a guild and the user to be in a voice channel. */
export async function requireUserInVoice(
  interaction: ChatInputCommandInteraction,
): Promise<string | null> {
  if (!interaction.inGuild()) {
    await replyError(interaction, "This command only works in a server.");
    return null;
  }
  const vcId = memberVoiceChannelId(interaction);
  if (!vcId) {
    await replyError(interaction, "You must be in a voice channel.");
    return null;
  }
  return vcId;
}

/** Require an existing player; replies "nothing playing" otherwise. */
export async function requirePlayer(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<Player | null> {
  const player = interaction.guildId ? client.lavalink.getPlayer(interaction.guildId) : undefined;
  if (!player) {
    await replyError(interaction, "Nothing is playing right now.");
    return null;
  }
  return player;
}

/** Require an active player AND that the user is in the same voice channel. */
export async function requireActiveSameVC(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<Player | null> {
  const player = await requirePlayer(interaction, client);
  if (!player) return null;
  const vcId = memberVoiceChannelId(interaction);
  if (!vcId || vcId !== player.voiceChannelId) {
    await replyError(interaction, "You must be in the same voice channel as the bot.");
    return null;
  }
  return player;
}
