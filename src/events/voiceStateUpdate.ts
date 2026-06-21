import { Events } from "discord.js";
import type { Player } from "lavalink-client";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { BotEvent } from "../types/index.js";

const LEAVE_TIMER = "emptyLeaveTimer";

function cancelLeave(player: Player): void {
  const handle = player.getData<NodeJS.Timeout>(LEAVE_TIMER);
  if (handle) {
    clearTimeout(handle);
    player.deleteData(LEAVE_TIMER);
  }
}

function scheduleLeave(client: Parameters<BotEvent["execute"]>[0], player: Player): void {
  cancelLeave(player);
  const guildId = player.guildId;
  const handle = setTimeout(() => {
    const p = client.lavalink.getPlayer(guildId);
    if (!p) return;
    logger.info({ guildId }, "voice channel still empty — leaving");
    void p.destroy("voice channel empty");
  }, config.bot.idleTimeoutMs);
  player.setData(LEAVE_TIMER, handle);
}

/**
 * Auto-leave when the bot is left alone in the voice channel (spec §12).
 * Leaving is deferred by the idle timeout and cancelled if someone returns.
 */
const event: BotEvent<Events.VoiceStateUpdate> = {
  name: Events.VoiceStateUpdate,
  execute: (client, oldState, newState) => {
    if (!config.bot.autoLeaveOnEmpty) return;
    const guild = oldState.guild ?? newState.guild;
    if (!guild) return;

    const player = client.lavalink.getPlayer(guild.id);
    if (!player?.voiceChannelId) return;

    const channel = guild.channels.cache.get(player.voiceChannelId);
    if (!channel?.isVoiceBased()) return;

    const humans = channel.members.filter((m) => !m.user.bot).size;
    if (humans === 0) scheduleLeave(client, player);
    else cancelLeave(player);
  },
};

export default event;
