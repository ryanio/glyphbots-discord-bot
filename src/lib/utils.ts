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
export const timeout = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Alias for timeout - delay execution for a specified number of milliseconds
 */
export const delay = timeout;

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
export const formatTimeAgo = (date: Date | string): string => {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - dateObj.getTime();
  const diffSeconds = Math.floor(diffMs / MS_PER_SECOND);
  const diffMinutes = Math.floor(diffSeconds / SECONDS_PER_MINUTE);
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
  if (diffSeconds > 0) {
    return `${diffSeconds} second${diffSeconds === 1 ? "" : "s"} ago`;
  }
  return "just now";
};

/**
 * Formats a Unix timestamp as a relative time string (e.g., "2 hours ago")
 */
export const formatUnixTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp * MS_PER_SECOND;
  const diffSeconds = Math.floor(diffMs / MS_PER_SECOND);
  const diffMinutes = Math.floor(diffSeconds / SECONDS_PER_MINUTE);
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
  if (diffSeconds > 0) {
    return `${diffSeconds} second${diffSeconds === 1 ? "" : "s"} ago`;
  }
  return "just now";
};

/**
 * Formats a Unix timestamp as a human-readable date (e.g., "Dec 4, 2025, 10:30 AM")
 */
export const formatReadableDate = (timestamp: number): string => {
  const date = new Date(timestamp * MS_PER_SECOND);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

/**
 * Weighted random selection favoring lower indices (first items in list)
 * Uses exponential distribution to heavily favor early items
 *
 * @param length - Array length (number of items)
 * @param weight - Weight factor (higher = more bias towards start). Default 2.0
 * @returns Random index between 0 and length-1, weighted towards 0
 */
export const weightedRandomIndex = (length: number, weight = 2.0): number => {
  if (length <= 0) {
    return 0;
  }
  // Generate a random number with exponential distribution
  // This naturally favors values closer to 0 when using power function
  const random = Math.random();
  const weighted = random ** weight;

  // Scale to range [0, length-1]
  return Math.min(Math.floor(weighted * length), length - 1);
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
  if (error === null || error === undefined) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
