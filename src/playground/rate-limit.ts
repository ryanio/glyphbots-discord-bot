/**
 * Playground User Action Rate Limiting
 *
 * Tracks user actions to enforce rate limits (max 1 per type per 6 hours).
 */

import { dirname, join } from "node:path";
import { ensureDirectory, readFileText, writeFileText } from "../lib/fs";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("PlaygroundRateLimit");

/** User action types */
export type UserActionType =
  | "request_spotlight"
  | "request_discovery"
  | "request_encounter"
  | "request_postcard"
  | "request_recap"
  | "request_help";

/** Rate limit state for a single user */
type UserRateLimitState = {
  [K in UserActionType]?: number;
};

/** Full rate limit state (userId -> action timestamps) */
type RateLimitState = Record<string, UserRateLimitState>;

/** Default state directory */
const DEFAULT_STATE_DIR = ".state";

/** Rate limit file name */
const RATE_LIMIT_FILE_NAME = "playground-rate-limits.json";

/** Milliseconds in 6 hours */
const MS_PER_6_HOURS = 6 * 60 * 60 * 1000;

/**
 * Rate limit store
 */
class RateLimitStore {
  private readonly filePath: string;
  private readonly enablePersistence: boolean;
  private loaded = false;
  private dirty = false;
  private state: RateLimitState = {};

  constructor(options: { filePath: string; enablePersistence: boolean }) {
    this.filePath = options.filePath;
    this.enablePersistence = options.enablePersistence;
  }

  /**
   * Load state from disk
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    if (!this.enablePersistence) {
      return;
    }

    await this.loadFromDisk();
  }

  /**
   * Load state from disk file
   */
  private async loadFromDisk(): Promise<void> {
    try {
      const content = await this.readStateFile();
      if (!content) {
        return;
      }

      const parsed = JSON.parse(content) as RateLimitState;
      this.state = parsed;
      log.debug(`Loaded rate limit state from ${this.filePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.debug("Failed to load rate limit state:", error);
      }
    }
  }

  /**
   * Read state file from disk
   */
  private async readStateFile(): Promise<string | undefined> {
    const dir = dirname(this.filePath);
    await ensureDirectory(dir);
    const content = await readFileText(this.filePath);
    return content;
  }

  /**
   * Clean up old entries for a single user
   */
  private cleanupUserState(
    userState: UserRateLimitState,
    cutoff: number
  ): boolean {
    let hasValidEntries = false;

    for (const actionType in userState) {
      if (!Object.hasOwn(userState, actionType)) {
        continue;
      }
      const timestamp = userState[actionType as UserActionType];
      if (timestamp && timestamp < cutoff) {
        delete userState[actionType as UserActionType];
      } else if (timestamp) {
        hasValidEntries = true;
      }
    }

    return hasValidEntries;
  }

  /**
   * Clean up old entries (older than 6 hours)
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - MS_PER_6_HOURS;

    for (const userId in this.state) {
      if (!Object.hasOwn(this.state, userId)) {
        continue;
      }
      const userState = this.state[userId];
      const hasValidEntries = this.cleanupUserState(userState, cutoff);

      if (!hasValidEntries) {
        delete this.state[userId];
      }
    }
  }

  /**
   * Check if user can perform an action (not rate limited)
   */
  canPerformAction(userId: string, actionType: UserActionType): boolean {
    this.cleanup();

    const userState = this.state[userId];
    if (!userState) {
      return true;
    }

    const lastTimestamp = userState[actionType];
    if (!lastTimestamp) {
      return true;
    }

    const now = Date.now();
    const elapsed = now - lastTimestamp;
    return elapsed >= MS_PER_6_HOURS;
  }

  /**
   * Record that a user performed an action
   */
  recordAction(userId: string, actionType: UserActionType): void {
    this.cleanup();

    if (!this.state[userId]) {
      this.state[userId] = {};
    }

    this.state[userId][actionType] = Date.now();
    this.dirty = true;
  }

  /**
   * Get time remaining until user can perform action again (in milliseconds)
   */
  getTimeRemaining(userId: string, actionType: UserActionType): number {
    this.cleanup();

    const userState = this.state[userId];
    if (!userState) {
      return 0;
    }

    const lastTimestamp = userState[actionType];
    if (!lastTimestamp) {
      return 0;
    }

    const now = Date.now();
    const elapsed = now - lastTimestamp;
    const remaining = MS_PER_6_HOURS - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Flush state to disk
   */
  async flush(): Promise<void> {
    if (!(this.enablePersistence && this.dirty)) {
      return;
    }

    try {
      const dir = dirname(this.filePath);
      await ensureDirectory(dir);
      await writeFileText(this.filePath, JSON.stringify(this.state, null, 2));
      this.dirty = false;
      log.debug(`Rate limit state saved to ${this.filePath}`);
    } catch (error) {
      log.error("Failed to persist rate limit state:", error);
    }
  }
}

/** Singleton store instance */
let storeInstance: RateLimitStore | null = null;

/**
 * Get the rate limit store
 */
const getRateLimitStore = (): RateLimitStore => {
  if (storeInstance) {
    return storeInstance;
  }

  const rootDir = process.cwd();
  const stateDir = process.env.STATE_DIR ?? DEFAULT_STATE_DIR;
  const filePath = join(rootDir, stateDir, RATE_LIMIT_FILE_NAME);

  const enablePersistence = process.env.NODE_ENV !== "test";

  storeInstance = new RateLimitStore({
    filePath,
    enablePersistence,
  });

  return storeInstance;
};

/**
 * Check if a user can perform an action
 */
export const canUserPerformAction = async (
  userId: string,
  actionType: UserActionType
): Promise<boolean> => {
  const store = getRateLimitStore();
  await store.load();
  return store.canPerformAction(userId, actionType);
};

/**
 * Record that a user performed an action
 */
export const recordUserAction = async (
  userId: string,
  actionType: UserActionType
): Promise<void> => {
  const store = getRateLimitStore();
  await store.load();
  store.recordAction(userId, actionType);
  await store.flush();
};

/**
 * Get time remaining until user can perform action again (in milliseconds)
 */
export const getActionTimeRemaining = async (
  userId: string,
  actionType: UserActionType
): Promise<number> => {
  const store = getRateLimitStore();
  await store.load();
  return store.getTimeRemaining(userId, actionType);
};

/**
 * Format time remaining as human-readable string
 */
export const formatTimeRemaining = (ms: number): string => {
  if (ms <= 0) {
    return "now";
  }

  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};
