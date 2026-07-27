/**
 * Application Constants
 *
 * Centralized constants used across the Discord bot application.
 */

// ============================================================================
// Time Constants
// ============================================================================

/** Milliseconds per second */
export const MS_PER_SECOND = 1000;

/** Seconds per minute */
export const SECONDS_PER_MINUTE = 60;

// ============================================================================
// Configuration Constants
// ============================================================================

/** Min interval in minutes for lore posts (4 hours) */
export const LORE_MIN_INTERVAL_MINUTES = 240;

/** Max interval in minutes for lore posts (12 hours) */
export const LORE_MAX_INTERVAL_MINUTES = 720;

/** GlyphBots API URL */
export const DEFAULT_GLYPHBOTS_API_URL = "https://glyphbots.com";

/** Arena challenge timeout in seconds (24 hours) */
export const ARENA_CHALLENGE_TIMEOUT_SECONDS = 86_400;

/** Arena round timeout in seconds (24 hours) */
export const ARENA_ROUND_TIMEOUT_SECONDS = 86_400;

/** Arena max rounds per battle */
export const ARENA_MAX_ROUNDS = 5;

/** Playground min interval in minutes (4 hours) */
export const PLAYGROUND_MIN_INTERVAL_MINUTES = 240;

/** Playground max interval in minutes (12 hours) */
export const PLAYGROUND_MAX_INTERVAL_MINUTES = 720;

/** How often the mint watcher polls for newly minted artifacts (minutes) */
export const MINTS_POLL_INTERVAL_MINUTES = 5;

/** Max mints posted individually in one poll before the rest are summarized */
export const MINTS_MAX_POSTS_PER_POLL = 5;

/** Pause between consecutive mint posts to stay under Discord rate limits (ms) */
export const MINTS_POST_DELAY_MS = 1500;

// ============================================================================
// Arena Constants
// ============================================================================

/** Thread auto-archive duration in minutes (24 hours) */
export const THREAD_AUTO_ARCHIVE_MINUTES = 1440;

// ============================================================================
// Discord API Constants
// ============================================================================

/** Discord API version */
export const DISCORD_API_VERSION = "10";
