/**
 * Slash Command Definitions
 *
 * Defines all slash commands for the GlyphBots Discord bot.
 */

import { SlashCommandBuilder } from "discord.js";

/** Maximum bot token ID */
const MAX_BOT_TOKEN_ID = 11_111;

/**
 * /help [topic] - Get help with GlyphBots features
 */
export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Get help with GlyphBots features")
  .addStringOption((option) =>
    option
      .setName("topic")
      .setDescription("Specific help topic")
      .setRequired(false)
      .addChoices(
        { name: "⚔️ Arena Battles", value: "arena" },
        { name: "📖 Lore Channel", value: "lore" },
        { name: "🎮 Playground", value: "playground" },
        { name: "🔍 Bot & Artifact Lookups", value: "lookups" },
        { name: "👁️ Spectating", value: "spectating" },
        { name: "🎮 All Commands", value: "commands" }
      )
  );

/**
 * /info [bot|artifact|stats] - Get information about bots, artifacts, or the bot itself
 */
export const infoCommand = new SlashCommandBuilder()
  .setName("info")
  .setDescription("Get information about bots, artifacts, or the bot itself")
  .addSubcommand((sub) =>
    sub
      .setName("bot")
      .setDescription("Look up a specific bot")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Bot token ID (1-11111)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(MAX_BOT_TOKEN_ID)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("artifact")
      .setDescription("Look up a specific artifact")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Artifact contract token ID")
          .setRequired(true)
          .setMinValue(1)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("about").setDescription("Bot statistics and uptime")
  );

/**
 * /arena <subcommand> - Arena battle commands
 */
export const arenaCommand = new SlashCommandBuilder()
  .setName("arena")
  .setDescription("Arena battle commands")
  .addSubcommand((sub) =>
    sub
      .setName("challenge")
      .setDescription("Challenge someone to a battle")
      .addIntegerOption((opt) =>
        opt
          .setName("bot")
          .setDescription("Your bot's token ID")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(MAX_BOT_TOKEN_ID)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("stats")
      .setDescription("View arena statistics")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to check (defaults to you)")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("leaderboard").setDescription("View top arena fighters")
  )
  .addSubcommand((sub) =>
    sub.setName("history").setDescription("View recent battles")
  )
  .addSubcommand((sub) =>
    sub.setName("forfeit").setDescription("Surrender your current battle")
  )
  .addSubcommand((sub) =>
    sub.setName("help").setDescription("Arena quick-start guide")
  );

/**
 * /spotlight - Show the current featured bot
 */
export const spotlightCommand = new SlashCommandBuilder()
  .setName("spotlight")
  .setDescription("Show the current featured bot");

/**
 * /random <type> - Get a random showcase
 */
export const randomCommand = new SlashCommandBuilder()
  .setName("random")
  .setDescription("Get a random showcase")
  .addStringOption((opt) =>
    opt
      .setName("type")
      .setDescription("What to show")
      .setRequired(true)
      .addChoices(
        { name: "🤖 Random Bot", value: "bot" },
        { name: "🎨 Random Artifact", value: "artifact" },
        { name: "🌍 Random World", value: "world" }
      )
  );

/**
 * /tips - Get a helpful GlyphBots tip
 */
export const tipsCommand = new SlashCommandBuilder()
  .setName("tips")
  .setDescription("Get a helpful GlyphBots tip");

/**
 * /stats - View GlyphBots statistics
 */
export const statsCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View GlyphBots statistics")
  .addSubcommand((sub) =>
    sub.setName("me").setDescription("Your personal stats overview")
  )
  .addSubcommand((sub) =>
    sub
      .setName("arena")
      .setDescription("Arena battle record")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to check (defaults to you)")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("server").setDescription("Server-wide activity stats")
  )
  .addSubcommand((sub) =>
    sub
      .setName("bot")
      .setDescription("Combat stats for a specific GlyphBot")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Bot token ID")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(MAX_BOT_TOKEN_ID)
      )
  );

/**
 * All command definitions for registration
 */
export const commands = [
  helpCommand,
  infoCommand,
  arenaCommand,
  spotlightCommand,
  randomCommand,
  tipsCommand,
  statsCommand,
];

/**
 * Get commands as JSON for deployment
 */
export const getCommandsJSON = (): object[] =>
  commands.map((cmd) => cmd.toJSON());
