import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { prefixedLogger } from "./logger";

const log = prefixedLogger("State");

/** Default state directory */
export const DEFAULT_STATE_DIR = ".state";

/** State file name */
const STATE_FILE_NAME = "glyphbots-discord-bot-state.json";

/** Channel types for state tracking */
export type ChannelType = "lore" | "arena" | "playground";

/** Source of the last post timestamp */
export type LastPostSource = "state_file" | "new";

/** State for a single channel */
export type ChannelState = {
  lastPostTimestamp: number | null;
  lastPostArtifactId: string | null;
  lastPostBotName: string | null;
  lastPostTitle: string | null;
};

/** Persisted state structure with keys for each channel */
export type PersistedState = {
  lore: ChannelState | null;
  arena: ChannelState | null;
  playground: ChannelState | null;
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
    await mkdir(dir, { recursive: true });
    const content = await readFile(this.filePath, "utf8");
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
      await mkdir(dir, { recursive: true });
      await writeFile(
        this.filePath,
        JSON.stringify(this.state, null, 2),
        "utf8"
      );
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
 * Get the state file path (for display)
 */
export const getStateFilePath = (): string => {
  const rootDir = process.cwd();
  const stateDir = process.env.STATE_DIR ?? DEFAULT_STATE_DIR;
  return join(rootDir, stateDir, STATE_FILE_NAME);
};
