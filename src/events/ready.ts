import { ActivityType, Events } from "discord.js";
import { logger } from "../logger.js";
import type { BotEvent } from "../types/index.js";

const event: BotEvent<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute: (client, readyClient) => {
    logger.info(
      { tag: readyClient.user.tag, guilds: client.guilds.cache.size },
      "bot logged in and ready",
    );
    // Initialise lavalink-client now that we know our own user id.
    void client.lavalink.init({ id: readyClient.user.id, username: readyClient.user.username });
    readyClient.user.setActivity({ name: "/play 🎵", type: ActivityType.Listening });
  },
};

export default event;
