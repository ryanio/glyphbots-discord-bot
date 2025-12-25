import {
  DEFAULT_ARENA_CHALLENGE_TIMEOUT_SECONDS,
  DEFAULT_ARENA_MAX_ROUNDS,
  DEFAULT_ARENA_ROUND_TIMEOUT_SECONDS,
  DEFAULT_GLYPHBOTS_API_URL,
  DEFAULT_LORE_MAX_INTERVAL_MINUTES,
  DEFAULT_LORE_MIN_INTERVAL_MINUTES,
  DEFAULT_PLAYGROUND_MAX_INTERVAL_MINUTES,
  DEFAULT_PLAYGROUND_MIN_INTERVAL_MINUTES,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from "./constants";
import type { Config } from "./types";

/**
 * Parse number from environment variable with default fallback
 */
const parseEnvNumber = (
  envVar: string | undefined,
  defaultValue: number
): number => Number(envVar) || defaultValue;

/**
 * Load and validate configuration from environment variables
 */
export const loadConfig = (): Config => {
  const discordToken = process.env.DISCORD_TOKEN;
  const discordClientId = process.env.DISCORD_CLIENT_ID;
  const loreChannelId = process.env.LORE_CHANNEL_ID;
  const googleAiApiKey = process.env.GOOGLE_AI_API_KEY;

  if (!discordToken) {
    throw new Error("DISCORD_TOKEN environment variable is required");
  }

  if (!discordClientId) {
    throw new Error("DISCORD_CLIENT_ID environment variable is required");
  }

  if (!loreChannelId) {
    throw new Error("LORE_CHANNEL_ID environment variable is required");
  }

  if (!googleAiApiKey) {
    throw new Error("GOOGLE_AI_API_KEY environment variable is required");
  }

  const loreMinIntervalMinutes = parseEnvNumber(
    process.env.LORE_MIN_INTERVAL_MINUTES,
    DEFAULT_LORE_MIN_INTERVAL_MINUTES
  );
  const loreMaxIntervalMinutes = parseEnvNumber(
    process.env.LORE_MAX_INTERVAL_MINUTES,
    DEFAULT_LORE_MAX_INTERVAL_MINUTES
  );

  return {
    discordToken,
    discordClientId,
    discordGuildId: process.env.DISCORD_GUILD_ID ?? null,
    loreChannelId,
    loreMinIntervalMinutes,
    loreMaxIntervalMinutes,
    arenaChannelId: process.env.ARENA_CHANNEL_ID ?? null,
    arenaChallengeTimeoutSeconds: parseEnvNumber(
      process.env.ARENA_CHALLENGE_TIMEOUT_SECONDS,
      DEFAULT_ARENA_CHALLENGE_TIMEOUT_SECONDS
    ),
    arenaRoundTimeoutSeconds: parseEnvNumber(
      process.env.ARENA_ROUND_TIMEOUT_SECONDS,
      DEFAULT_ARENA_ROUND_TIMEOUT_SECONDS
    ),
    arenaMaxRounds: parseEnvNumber(
      process.env.ARENA_MAX_ROUNDS,
      DEFAULT_ARENA_MAX_ROUNDS
    ),
    playgroundChannelId: process.env.PLAYGROUND_CHANNEL_ID ?? null,
    playgroundMinIntervalMinutes: parseEnvNumber(
      process.env.PLAYGROUND_MIN_INTERVAL_MINUTES,
      DEFAULT_PLAYGROUND_MIN_INTERVAL_MINUTES
    ),
    playgroundMaxIntervalMinutes: parseEnvNumber(
      process.env.PLAYGROUND_MAX_INTERVAL_MINUTES,
      DEFAULT_PLAYGROUND_MAX_INTERVAL_MINUTES
    ),
    googleAiApiKey,
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
