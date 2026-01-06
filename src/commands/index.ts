/**
 * Slash Command Definitions
 *
 * Defines all slash commands for the GlyphBots Discord bot.
 */

import { SlashCommandBuilder } from "discord.js";

/** Maximum bot token ID */
const MAX_BOT_TOKEN_ID = 11_111;

/**
 * /wallet <subcommand> - Manage your Ethereum wallet connection
 */
export const walletCommand = new SlashCommandBuilder()
  .setName("wallet")
  .setDescription("Manage your Ethereum wallet connection")
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Connect your Ethereum wallet")
      .addStringOption((opt) =>
        opt
          .setName("address")
          .setDescription("Your Ethereum address (e.g., 0x...)")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("view").setDescription("View your connected wallet")
  )
  .addSubcommand((sub) =>
    sub.setName("clear").setDescription("Disconnect your wallet")
  );

/**
 * /mybots - View your owned GlyphBots
 */
export const mybotsCommand = new SlashCommandBuilder()
  .setName("mybots")
  .setDescription("View your owned GlyphBots (requires wallet connection)");

/**
 * /floor - View GlyphBots collection stats and floor price
 */
export const floorCommand = new SlashCommandBuilder()
  .setName("floor")
  .setDescription("View GlyphBots collection stats and floor price");

/**
 * /owner <bot> - Check who owns a specific GlyphBot
 */
export const ownerCommand = new SlashCommandBuilder()
  .setName("owner")
  .setDescription("Check who owns a specific GlyphBot")
  .addIntegerOption((opt) =>
    opt
      .setName("bot")
      .setDescription("Bot token ID (1-11111)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_BOT_TOKEN_ID)
  );

/**
 * /sales - View recent GlyphBots sales
 */
export const salesCommand = new SlashCommandBuilder()
  .setName("sales")
  .setDescription("View recent GlyphBots sales on OpenSea");

/**
 * /listings - View cheapest GlyphBots for sale
 */
export const listingsCommand = new SlashCommandBuilder()
  .setName("listings")
  .setDescription("View cheapest GlyphBots currently listed for sale");

/**
 * /rarity <bot> - Check a bot's rarity and traits
 */
export const rarityCommand = new SlashCommandBuilder()
  .setName("rarity")
  .setDescription("Check a GlyphBot's rarity rank and traits")
  .addIntegerOption((opt) =>
    opt
      .setName("bot")
      .setDescription("Bot token ID (1-11111)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_BOT_TOKEN_ID)
  );

/**
 * /activity <bot> - View recent activity for a specific bot
 */
export const activityCommand = new SlashCommandBuilder()
  .setName("activity")
  .setDescription("View recent activity for a specific GlyphBot")
  .addIntegerOption((opt) =>
    opt
      .setName("bot")
      .setDescription("Bot token ID (1-11111)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_BOT_TOKEN_ID)
  );

/**
 * /bot [id] [random] [user] - Display a GlyphBot with OpenSea data
 */
export const botCommand = new SlashCommandBuilder()
  .setName("bot")
  .setDescription("Display a GlyphBot with full details and OpenSea data")
  .addIntegerOption((opt) =>
    opt
      .setName("id")
      .setDescription("Bot token ID (1-11111)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(MAX_BOT_TOKEN_ID)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("random")
      .setDescription(
        "Show a random bot (uses your owned bots if wallet connected)"
      )
      .setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName("user")
      .setDescription(
        "OpenSea username or wallet address to pick a random bot from"
      )
      .setRequired(false)
  );

/**
 * /artifact [id] [random] - Display a GlyphBots artifact
 */
export const artifactCommand = new SlashCommandBuilder()
  .setName("artifact")
  .setDescription("Display a GlyphBots artifact with details")
  .addIntegerOption((opt) =>
    opt
      .setName("id")
      .setDescription("Artifact contract token ID")
      .setRequired(false)
      .setMinValue(1)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("random")
      .setDescription("Show a random recent artifact")
      .setRequired(false)
  );

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
          .setDescription("Bot token ID (optional if wallet connected)")
          .setRequired(false)
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
    sub.setName("cancel").setDescription("Cancel your active challenge")
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
  walletCommand,
  mybotsCommand,
  floorCommand,
  ownerCommand,
  salesCommand,
  listingsCommand,
  rarityCommand,
  activityCommand,
  botCommand,
  artifactCommand,
];

/**
 * Get commands as JSON for deployment
 */
export const getCommandsJSON = (): object[] =>
  commands.map((cmd) => cmd.toJSON());
