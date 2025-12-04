import type { Config } from "./types";

/** Milliseconds per second */
export const MS_PER_SECOND = 1000;

/** Seconds per minute */
export const SECONDS_PER_MINUTE = 60;

/** Default interval in minutes for lore posts */
export const DEFAULT_LORE_INTERVAL_MINUTES = 30;

/** Default OpenRouter model */
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4";

/** Default GlyphBots API URL */
export const DEFAULT_GLYPHBOTS_API_URL = "https://glyphbots.com";

/**
 * Load and validate configuration from environment variables
 */
export const loadConfig = (): Config => {
  const discordToken = process.env.DISCORD_TOKEN;
  const loreChannelId = process.env.LORE_CHANNEL_ID;
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;

  if (!discordToken) {
    throw new Error("DISCORD_TOKEN environment variable is required");
  }

  if (!loreChannelId) {
    throw new Error("LORE_CHANNEL_ID environment variable is required");
  }

  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }

  const loreIntervalMinutes =
    Number(process.env.LORE_INTERVAL_MINUTES) || DEFAULT_LORE_INTERVAL_MINUTES;

  return {
    discordToken,
    loreChannelId,
    loreIntervalMinutes,
    openRouterApiKey,
    openRouterModel: process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
    glyphbotsApiUrl: process.env.GLYPHBOTS_API_URL ?? DEFAULT_GLYPHBOTS_API_URL,
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
};

/**
 * Delay execution for a specified number of milliseconds
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Format a date as a readable timestamp
 */
export const formatTimestamp = (date: Date): string =>
  date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

/**
 * Format a time ago string (e.g., "2 days ago", "3 hours ago")
 */
export const formatTimeAgo = (date: Date): string => {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / (MS_PER_SECOND * SECONDS_PER_MINUTE));
  const diffHours = Math.floor(diffMinutes / SECONDS_PER_MINUTE);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }
  if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  return "just now";
};

/**
 * Weighted random selection favoring higher indices (more recent items)
 * Uses exponential distribution to heavily favor recent items
 *
 * @param max - Maximum value (exclusive)
 * @param weight - Weight factor (higher = more bias towards recent). Default 2.0
 * @returns Random number between 1 and max, weighted towards max
 */
export const weightedRandomIndex = (max: number, weight = 2.0): number => {
  // Generate a random number with exponential distribution
  // This naturally favors values closer to 1, which we invert
  const random = Math.random();
  const weighted = 1 - random ** weight;

  // Scale to range [1, max]
  return Math.floor(weighted * max) + 1;
};

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 */
export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
};

/**
 * Safely extract error message from unknown error type
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
