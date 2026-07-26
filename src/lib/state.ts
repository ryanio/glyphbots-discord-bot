import { dirname, join } from "node:path";
import { ensureDirectory, readFileText, writeFileText } from "./fs";
import { prefixedLogger } from "./logger";

const log = prefixedLogger("State");

/** Default state directory */
export const DEFAULT_STATE_DIR = ".state";

/** State file name */
const STATE_FILE_NAME = "glyphbots-discord-bot-state.json";

/** Channel types for state tracking */
export type ChannelType = "lore" | "arena" | "playground" | "mints";

/** Maximum number of posted artifact ids retained for dedupe */
export const MINTS_POSTED_ID_HISTORY = 100;

/** Source of the last post timestamp */
export type LastPostSource = "state_file" | "new";

/** State for a single channel */
export type ChannelState = {
  lastPostTimestamp: number | null;
  lastPostArtifactId: string | null;
  lastPostBotName: string | null;
  lastPostTitle: string | null;
};

/**
 * Mint watcher cursor.
 *
 * `lastMintedAtMs` is derived from the artifact's own `mintedAt` value, never
 * from wall clock time, so a restart or a slow poll can't skip mints. Because
 * several artifacts can share one `mintedAt` and the API can reorder items,
 * `postedArtifactIds` acts as a second guard against reposting.
 */
export type MintsCursorState = {
  lastMintedAtMs: number | null;
  postedArtifactIds: string[];
};

/** Persisted state structure with keys for each channel */
export type PersistedState = {
  lore: ChannelState | null;
  arena: ChannelState | null;
  playground: ChannelState | null;
  mints: ChannelState | null;
  mintsCursor: MintsCursorState | null;
};

/** Last post info with source */
export type LastPostInfo = {
  timestamp: number;
  artifactId: string | null;
  botName: string | null;
  title: string | null;
  source: LastPostSource;
};

/** Default empty channel state */
const _emptyChannelState = (): ChannelState => ({
  lastPostTimestamp: null,
  lastPostArtifactId: null,
  lastPostBotName: null,
  lastPostTitle: null,
});

/** Default empty persisted state */
const emptyPersistedState = (): PersistedState => ({
  lore: null,
  arena: null,
  playground: null,
  mints: null,
  mintsCursor: null,
});

/**
 * Bot state store for tracking post history across channels
 */
class BotStateStore {
  private readonly filePath: string;
  private readonly enablePersistence: boolean;

  private loaded = false;
  private dirty = false;

  private readonly state: PersistedState = emptyPersistedState();

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

      const parsed = JSON.parse(content) as Partial<PersistedState>;
      this.applyParsedState(parsed);
      log.debug(`Loaded state from ${this.filePath}`);
    } catch (error) {
      // File doesn't exist or is invalid - start fresh
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.debug("Failed to load state:", error);
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
   * Apply parsed state to instance
   */
  private applyParsedState(parsed: Partial<PersistedState>): void {
    if (parsed.lore !== undefined) {
      this.state.lore = parsed.lore;
    }
    if (parsed.arena !== undefined) {
      this.state.arena = parsed.arena;
    }
    if (parsed.playground !== undefined) {
      this.state.playground = parsed.playground;
    }
    if (parsed.mints !== undefined) {
      this.state.mints = parsed.mints;
    }
    if (parsed.mintsCursor !== undefined) {
      this.state.mintsCursor = parsed.mintsCursor;
    }
  }

  /**
   * Get the mint watcher cursor, or null if never seeded
   */
  getMintsCursor(): MintsCursorState | null {
    const cursor = this.state.mintsCursor;
    if (!cursor) {
      return null;
    }
    return {
      lastMintedAtMs: cursor.lastMintedAtMs ?? null,
      postedArtifactIds: [...(cursor.postedArtifactIds ?? [])],
    };
  }

  /**
   * Replace the mint watcher cursor, trimming the posted id history
   */
  setMintsCursor(cursor: MintsCursorState): void {
    this.state.mintsCursor = {
      lastMintedAtMs: cursor.lastMintedAtMs,
      postedArtifactIds: cursor.postedArtifactIds.slice(
        -MINTS_POSTED_ID_HISTORY
      ),
    };
    this.dirty = true;
  }

  /**
   * Get the last post info for a channel
   */
  getLastPostInfo(channel: ChannelType): LastPostInfo | null {
    const channelState = this.state[channel];
    if (!channelState?.lastPostTimestamp) {
      return null;
    }

    return {
      timestamp: channelState.lastPostTimestamp,
      artifactId: channelState.lastPostArtifactId,
      botName: channelState.lastPostBotName,
      title: channelState.lastPostTitle,
      source: "state_file",
    };
  }

  /**
   * Record a new post for a channel
   */
  recordPost(
    channel: ChannelType,
    info: {
      artifactId: string;
      botName: string;
      title: string;
    }
  ): void {
    this.state[channel] = {
      lastPostTimestamp: Math.floor(Date.now() / 1000),
      lastPostArtifactId: info.artifactId,
      lastPostBotName: info.botName,
      lastPostTitle: info.title,
    };
    this.dirty = true;
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
      log.debug(`State saved to ${this.filePath}`);
    } catch (error) {
      log.error("Failed to persist state:", error);
    }
  }
}

// Singleton store instance
let storeInstance: BotStateStore | null = null;

/**
 * Get the bot state store
 */
export const getBotStateStore = (): BotStateStore => {
  if (storeInstance) {
    return storeInstance;
  }

  const rootDir = process.cwd();
  const stateDir = process.env.STATE_DIR ?? DEFAULT_STATE_DIR;
  const filePath = join(rootDir, stateDir, STATE_FILE_NAME);

  const enablePersistence = process.env.NODE_ENV !== "test";

  storeInstance = new BotStateStore({
    filePath,
    enablePersistence,
  });

  return storeInstance;
};

/**
 * Resolve the last post info for a channel from state
 */
export const resolveLastPostInfo = async (
  channel: ChannelType = "lore"
): Promise<LastPostInfo | null> => {
  const store = getBotStateStore();
  await store.load();
  return store.getLastPostInfo(channel);
};

/**
 * Record a post to state for a channel
 */
export const recordLorePost = async (info: {
  artifactId: string;
  botName: string;
  title: string;
}): Promise<void> => {
  const store = getBotStateStore();
  store.recordPost("lore", info);
  await store.flush();
};

/**
 * Record a post to state for any channel
 */
export const recordChannelPost = async (
  channel: ChannelType,
  info: {
    artifactId: string;
    botName: string;
    title: string;
  }
): Promise<void> => {
  const store = getBotStateStore();
  store.recordPost(channel, info);
  await store.flush();
};

/**
 * Read the mint watcher cursor from state.
 * Returns null when the cursor has never been seeded (cold start).
 */
export const resolveMintsCursor =
  async (): Promise<MintsCursorState | null> => {
    const store = getBotStateStore();
    await store.load();
    return store.getMintsCursor();
  };

/**
 * Persist the mint watcher cursor to state
 */
export const recordMintsCursor = async (
  cursor: MintsCursorState
): Promise<void> => {
  const store = getBotStateStore();
  await store.load();
  store.setMintsCursor(cursor);
  await store.flush();
};

/**
 * Get the state file path (for display)
 */
export const getStateFilePath = (): string => {
  const rootDir = process.cwd();
  const stateDir = process.env.STATE_DIR ?? DEFAULT_STATE_DIR;
  return join(rootDir, stateDir, STATE_FILE_NAME);
};
