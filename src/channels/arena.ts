/**
 * Arena Channel Handler
 *
 * Manages the arena channel and battle timeouts.
 */

import type { Client, TextChannel } from "discord.js";
import {
  cleanupBattle,
  getAllBattles,
  getExpiredBattles,
} from "../arena/state";
import { prefixedLogger } from "../lib/logger";
import type { Config } from "../lib/types";
import { delay } from "../lib/utils";

const log = prefixedLogger("Arena");

/** Arena channel state */
type ArenaState = {
  channel: TextChannel;
  config: Config;
  isActive: boolean;
};

/** Expiry check interval (30 seconds) */
const EXPIRY_CHECK_INTERVAL_MS = 30 * 1000;

/** Channel state */
let arenaState: ArenaState | null = null;

/**
 * Check for expired battles and clean them up
 */
const checkExpiredBattles = async (): Promise<void> => {
  const expiredBattles = getExpiredBattles();

  for (const battle of expiredBattles) {
    log.info(`Battle ${battle.id} expired, cleaning up`);

    // Update the announcement message if in challenge phase
    if (battle.phase === "challenge" && battle.announcementMessageId) {
      try {
        const message = await arenaState?.channel.messages.fetch(
          battle.announcementMessageId
        );
        if (message) {
          await message.edit({
            content: "⏰ **This challenge has expired.**",
            embeds: [],
            components: [],
          });
        }
      } catch {
        // Message may have been deleted
      }
    }

    // Clean up the battle
    cleanupBattle(battle.id);
  }
};

/**
 * Expiry check loop
 */
const expiryCheckLoop = async (): Promise<void> => {
  if (!arenaState) {
    return;
  }

  while (arenaState.isActive) {
    await delay(EXPIRY_CHECK_INTERVAL_MS);

    if (arenaState.isActive) {
      await checkExpiredBattles();
    }
  }
};

/**
 * Get arena stats for display
 */
export const getArenaStats = (): {
  activeBattles: number;
  inCombat: number;
  waitingForChallengers: number;
} => {
  const battles = getAllBattles();
  const inCombat = battles.filter((b) => b.phase === "combat").length;
  const waitingForChallengers = battles.filter(
    (b) => b.phase === "challenge"
  ).length;

  return {
    activeBattles: battles.length,
    inCombat,
    waitingForChallengers,
  };
};

/**
 * Initialize the arena channel
 */
export const initArenaChannel = async (
  client: Client,
  config: Config
): Promise<void> => {
  if (!config.arenaChannelId) {
    log.info("Arena channel not configured, skipping initialization");
    return;
  }

  log.info(`Initializing arena channel: ${config.arenaChannelId}`);

  try {
    const channel = await client.channels.fetch(config.arenaChannelId);
    if (!(channel && "send" in channel)) {
      log.error("Arena channel not found or invalid");
      return;
    }

    arenaState = {
      channel: channel as TextChannel,
      config,
      isActive: true,
    };

    // Start the expiry check loop
    expiryCheckLoop().catch((error) => {
      log.error("Arena expiry check loop error:", error);
    });

    log.info("Arena channel initialized successfully");
  } catch (error) {
    log.error("Failed to initialize arena channel:", error);
  }
};

/**
 * Stop the arena channel
 */
export const stopArenaChannel = (): void => {
  if (arenaState) {
    arenaState.isActive = false;
    arenaState = null;
    log.info("Arena channel stopped");
  }
};

/**
 * Get the config for arena interactions
 */
export const getArenaConfig = (): Config | null => arenaState?.config ?? null;
