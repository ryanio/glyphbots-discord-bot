import "dotenv/config";

import { Client, Events, GatewayIntentBits } from "discord.js";
import { initLoreChannel } from "./channels/lore";
import { logger } from "./lib/logger";
import {
  type ChannelType,
  DEFAULT_STATE_DIR,
  type LastPostInfo,
  resolveLastPostInfo,
} from "./lib/state";
import type { Config } from "./lib/types";
import { formatReadableDate, formatUnixTimeAgo, loadConfig } from "./lib/utils";

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
 * Print basic configuration (before Discord connection)
 */
const printConfig = async (config: Config): Promise<void> => {
  // Load last post info for active channels
  const loreInfo = await resolveLastPostInfo("lore");
  // Future channels:
  // const arenaInfo = await resolveLastPostInfo("arena");
  // const playgroundInfo = await resolveLastPostInfo("playground");

  logger.info("");
  logger.info("┌─ 📋 CONFIGURATION");
  logger.info("│");
  logger.info(`│  🔗  GlyphBots API: ${config.glyphbotsApiUrl}`);
  logger.info(`│  🤖  AI Model: ${config.openRouterModel}`);
  logger.info(`│  📝  Log Level: ${config.logLevel}`);
  logger.info("│");
  logger.info("├─ 📁 STATE");
  logger.info("│");
  logger.info(
    `│  📂  Directory: ${process.env.STATE_DIR ?? DEFAULT_STATE_DIR}`
  );
  logger.info("│");
  formatChannelState("lore", loreInfo);
  // Future channels:
  // formatChannelState("arena", arenaInfo);
  // formatChannelState("playground", playgroundInfo);
  logger.info("│");
};

/**
 * Print channel configuration (after Discord connection)
 */
const printChannelConfig = async (
  client: Client,
  config: Config
): Promise<void> => {
  logger.info("├─ 📖 LORE CHANNEL");
  logger.info("│");

  // Fetch channel to get name
  let channelDisplay = config.loreChannelId;
  try {
    const channel = await client.channels.fetch(config.loreChannelId);
    if (channel && "name" in channel && channel.name) {
      channelDisplay = `#${channel.name}`;
    }
  } catch {
    // Fall back to ID if channel can't be fetched
  }

  logger.info(`│  📢  Channel: ${channelDisplay}`);
  logger.info(`│  ⏱️  Interval: ${config.loreIntervalMinutes} minutes`);
  logger.info("│");
  logger.info("└─");
  logger.info("");
};

/**
 * Main entry point
 */
async function main(): Promise<void> {
  printBanner();

  // Load and validate configuration
  logger.info("Loading configuration...");
  const config = loadConfig();
  await printConfig(config);

  // Create Discord client
  logger.info("Creating Discord client...");
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  // Handle ready event
  client.on(Events.ClientReady, async () => {
    // Print channel config now that we can resolve names
    await printChannelConfig(client, config);

    logger.info("════════════════════════════════════════════════════════════");
    logger.info(`🤖 Logged in as ${client.user?.tag}`);
    logger.info("════════════════════════════════════════════════════════════");

    try {
      // Initialize lore channel
      await initLoreChannel(client, config);
    } catch (error) {
      logger.error("Failed to initialize channels:", error);
      process.exit(1);
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
  logger.info("Connecting to Discord...");
  await client.login(config.discordToken);
}

// Only auto-start when not under test
if (process.env.NODE_ENV !== "test") {
  main();
}

// Export for testing
export { main };
