import "dotenv/config";

import { Client, Events, GatewayIntentBits } from "discord.js";
import { handleArenaButton, handleArenaSelectMenu } from "./arena/interactions";
import { initArenaChannel } from "./channels/arena";
import { initLoreChannel } from "./channels/lore";
import { initPlaygroundChannel } from "./channels/playground";
import { handleArena } from "./commands/arena";
import { handleHelp } from "./commands/help";
import { handleInfo } from "./commands/info";
import { handleRandom } from "./commands/random";
import { handleSpotlight } from "./commands/spotlight";
import { handleStats } from "./commands/stats";
import { handleTips } from "./commands/tips";
import {
  handleInteractionError,
  replyWithUnknownError,
} from "./lib/discord/errors";
import { prefixedLogger } from "./lib/logger";
import {
  type ChannelType,
  DEFAULT_STATE_DIR,
  type LastPostInfo,
  resolveLastPostInfo,
} from "./lib/state";
import type { Config } from "./lib/types";
import { formatReadableDate, formatUnixTimeAgo, loadConfig } from "./lib/utils";
import { handlePlaygroundButton } from "./playground/interactions";

const logger = prefixedLogger("Main");

/**
 * Print startup banner
 */
const printBanner = (): void => {
  const banner = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║    ██████╗ ██╗  ██╗   ██╗██████╗ ██╗  ██╗██████╗  ██████╗ ████████╗███████╗  ║
║   ██╔════╝ ██║  ╚██╗ ██╔╝██╔══██╗██║  ██║██╔══██╗██╔═══██╗╚══██╔══╝██╔════╝  ║
║   ██║  ███╗██║   ╚████╔╝ ██████╔╝███████║██████╔╝██║   ██║   ██║   ███████╗  ║
║   ██║   ██║██║    ╚██╔╝  ██╔═══╝ ██╔══██║██╔══██╗██║   ██║   ██║   ╚════██║  ║
║   ╚██████╔╝███████╗██║   ██║     ██║  ██║██████╔╝╚██████╔╝   ██║   ███████║  ║
║    ╚═════╝ ╚══════╝╚═╝   ╚═╝     ╚═╝  ╚═╝╚═════╝  ╚═════╝    ╚═╝   ╚══════╝  ║
║                                                                              ║
║                    Discord Bot - Lore • Arena • Playground                   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝`;

  for (const line of banner.split("\n")) {
    logger.info(line);
  }
};

/**
 * Format the source of last post info
 */
const _formatLastPostSource = (source: LastPostInfo["source"]): string => {
  switch (source) {
    case "state_file":
      return "state file";
    case "new":
      return "new (no previous posts)";
    default:
      return String(source);
  }
};

/** Channel display config */
const CHANNEL_DISPLAY: Record<ChannelType, { emoji: string; label: string }> = {
  lore: { emoji: "📖", label: "Lore" },
  arena: { emoji: "⚔️", label: "Arena" },
  playground: { emoji: "🎮", label: "Playground" },
};

/**
 * Format channel state for display
 */
const formatChannelState = (
  channel: ChannelType,
  info: LastPostInfo | null
): void => {
  const { emoji, label } = CHANNEL_DISPLAY[channel];

  if (info) {
    const ts = info.timestamp;
    logger.info(
      `│  ${emoji}  ${label}: ${formatReadableDate(ts)} (${formatUnixTimeAgo(ts)})`
    );
    if (info.title) {
      logger.info(`│      └─ ${info.title}`);
    }
  } else {
    logger.info(`│  ${emoji}  ${label}: No posts yet`);
  }
};

/**
 * Print full configuration (after Discord connection so we can resolve channel names)
 */
const printConfig = async (client: Client, config: Config): Promise<void> => {
  // Load last post info for active channels
  const loreInfo = await resolveLastPostInfo("lore");
  const arenaInfo = config.arenaChannelId
    ? await resolveLastPostInfo("arena")
    : null;
  const playgroundInfo = config.playgroundChannelId
    ? await resolveLastPostInfo("playground")
    : null;

  // Fetch lore channel name
  let loreChannelDisplay = config.loreChannelId;
  try {
    const channel = await client.channels.fetch(config.loreChannelId);
    if (channel && "name" in channel && channel.name) {
      loreChannelDisplay = `#${channel.name}`;
    }
  } catch {
    // Fall back to ID if channel can't be fetched
  }

  logger.info("");
  logger.info("┌─ 📋 CONFIGURATION");
  logger.info("│");
  logger.info(`│  🔗  GlyphBots API: ${config.glyphbotsApiUrl}`);
  logger.info("│  🤖  AI: Google Gemini");
  logger.info(`│  📝  Log Level: ${config.logLevel}`);
  logger.info("│");
  logger.info("├─ 📁 STATE");
  logger.info("│");
  logger.info(
    `│  📂  Directory: ${process.env.STATE_DIR ?? DEFAULT_STATE_DIR}`
  );
  logger.info("│");
  formatChannelState("lore", loreInfo);
  if (config.arenaChannelId) {
    formatChannelState("arena", arenaInfo);
  }
  if (config.playgroundChannelId) {
    formatChannelState("playground", playgroundInfo);
  }
  logger.info("│");
  logger.info("├─ 📖 LORE CHANNEL");
  logger.info("│");
  logger.info(`│  📢 Channel: ${loreChannelDisplay}`);
  logger.info(
    `│  ⏱️  Interval: ${config.loreMinIntervalMinutes}-${config.loreMaxIntervalMinutes} minutes (${Math.round(config.loreMinIntervalMinutes / 60)}-${Math.round(config.loreMaxIntervalMinutes / 60)} hours)`
  );
  logger.info("│");
  logger.info("└─");
  logger.info("");
};

/**
 * Handle slash command interactions
 */
const handleSlashCommand = async (
  interaction: import("discord.js").ChatInputCommandInteraction,
  config: Config
): Promise<void> => {
  const { commandName } = interaction;

  try {
    switch (commandName) {
      case "help":
        await handleHelp(interaction, config);
        break;
      case "info":
        await handleInfo(interaction);
        break;
      case "arena":
        await handleArena(interaction, config);
        break;
      case "spotlight":
        await handleSpotlight(interaction);
        break;
      case "random":
        await handleRandom(interaction);
        break;
      case "tips":
        await handleTips(interaction);
        break;
      case "stats":
        await handleStats(interaction);
        break;
      default:
        await interaction.reply({
          content: "Unknown command.",
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error(`Error handling command ${commandName}:`, error);
    const errorReply = {
      content: "An error occurred while processing this command.",
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply);
    } else {
      await interaction.reply(errorReply);
    }
  }
};

/**
 * Handle button interactions
 */
const handleButtonInteraction = async (
  interaction: import("discord.js").ButtonInteraction,
  config: Config
): Promise<void> => {
  const { customId } = interaction;

  try {
    // Arena buttons
    if (
      customId.startsWith("arena_") ||
      customId.startsWith("stance_") ||
      customId.startsWith("cheer_") ||
      customId.startsWith("bloodlust_") ||
      customId.startsWith("surge_")
    ) {
      await handleArenaButton(interaction, config);
      return;
    }

    // Playground buttons
    if (customId.startsWith("playground_")) {
      await handlePlaygroundButton(interaction);
      return;
    }

    // Other buttons (help, etc.)
    await replyWithUnknownError(interaction, "button");
  } catch (error) {
    await handleInteractionError(
      interaction,
      error,
      logger,
      `button ${customId}`
    );
  }
};

/**
 * Handle select menu interactions
 */
const handleSelectMenuInteraction = async (
  interaction: import("discord.js").StringSelectMenuInteraction,
  config: Config
): Promise<void> => {
  const { customId } = interaction;

  try {
    // Arena select menus
    if (customId.startsWith("select_bot_") || customId.startsWith("ability_")) {
      await handleArenaSelectMenu(interaction, config);
      return;
    }

    await replyWithUnknownError(interaction, "menu");
  } catch (error) {
    await handleInteractionError(
      interaction,
      error,
      logger,
      `select menu ${customId}`
    );
  }
};

/**
 * Main entry point
 */
async function main(): Promise<void> {
  printBanner();

  // Load and validate configuration
  const config = loadConfig();

  // Create Discord client with necessary intents
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  // Handle ready event
  client.on(Events.ClientReady, async () => {
    // Print all configuration together now that we can resolve channel names
    await printConfig(client, config);

    logger.info("════════════════════════════════════════════════════════════");
    logger.info(`🤖 Logged in as ${client.user?.tag}`);
    logger.info("════════════════════════════════════════════════════════════");

    try {
      // Initialize channels and collect status
      const loreStatus = await initLoreChannel(client, config);
      const arenaStatus = await initArenaChannel(client, config);
      const playgroundStatus = await initPlaygroundChannel(client, config);

      // Print consolidated channel status
      logger.info("");
      logger.info("┌─ 🚀 CHANNELS INITIALIZED");
      logger.info("│");

      if (loreStatus) {
        const nextPostInfo = loreStatus.nextPostMinutes
          ? `Next post in ${loreStatus.nextPostMinutes} min`
          : "Scheduled";
        logger.info(
          `│  📖 Lore: #${loreStatus.channelName} | ${loreStatus.status} | ${nextPostInfo}`
        );
      }

      if (arenaStatus) {
        logger.info(
          `│  ⚔️ Arena: #${arenaStatus.channelName} | ${arenaStatus.status}`
        );
      }

      if (playgroundStatus) {
        logger.info(
          `│  🎮 Playground: #${playgroundStatus.channelName} | ${playgroundStatus.status} | Next post in ${playgroundStatus.nextPostMinutes} min`
        );
      }

      logger.info("│");
      logger.info("└─ ✅ All systems ready");
      logger.info("");
    } catch (error) {
      logger.error("Failed to initialize channels:", error);
      process.exit(1);
    }
  });

  // Handle interactions (slash commands, buttons, etc.)
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, config);
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction, config);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction, config);
    }
  });

  // Handle errors
  client.on(Events.Error, (error) => {
    logger.error("Discord client error:", error);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("");
    logger.info("⚠️ Interrupt signal received (SIGINT)");
    logger.info("🛑 Shutting down gracefully...");
    client.destroy();
    logger.info("✅ Bot stopped successfully");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("");
    logger.info("⚠️ Terminate signal received (SIGTERM)");
    logger.info("🛑 Shutting down gracefully...");
    client.destroy();
    logger.info("✅ Bot stopped successfully");
    process.exit(0);
  });

  // Connect to Discord
  await client.login(config.discordToken);
}

// Only auto-start when not under test
if (process.env.NODE_ENV !== "test") {
  main();
}

// Export for testing
export { main };
