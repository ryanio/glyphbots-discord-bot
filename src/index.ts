import "dotenv/config";

import { Client, Events, GatewayIntentBits } from "discord.js";
import { initLoreChannel } from "./channels/lore";
import { logger } from "./lib/logger";
import type { Config } from "./lib/types";
import { loadConfig } from "./lib/utils";

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
 * Print basic configuration (before Discord connection)
 */
const printConfig = (config: Config): void => {
  logger.info("");
  logger.info("┌─ 📋 CONFIGURATION");
  logger.info("│");
  logger.info(`│  🔗  GlyphBots API: ${config.glyphbotsApiUrl}`);
  logger.info(`│  🤖  AI Model: ${config.openRouterModel}`);
  logger.info(`│  📝  Log Level: ${config.logLevel}`);
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
  logger.info(`│  ⏱️   Interval: ${config.loreIntervalMinutes} minutes`);
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
  printConfig(config);

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
