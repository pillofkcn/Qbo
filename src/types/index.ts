import type {
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  Collection,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { LavalinkManager } from "lavalink-client";

/** A slash command module: a builder + an execute handler. */
export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder;
  /** Hide from the bot's listing if true (none currently). */
  guildOnly?: boolean;
  execute: (
    interaction: ChatInputCommandInteraction,
    client: Client,
  ) => Promise<void> | void;
}

/** A discord.js gateway event module loaded by the event loader. */
export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute: (client: Client, ...args: ClientEvents[K]) => Promise<void> | void;
}

// Augment the discord.js Client so `client.commands` and `client.lavalink`
// are typed everywhere. They are assigned during bootstrap in src/index.ts.
declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
    lavalink: LavalinkManager;
  }
}
