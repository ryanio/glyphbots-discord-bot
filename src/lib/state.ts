import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { prefixedLogger } from "./logger";

const log = prefixedLogger("State");

/** Default state directory */
export const DEFAULT_STATE_DIR = ".state";

/** State file name */
const STATE_FILE_NAME = "lore-state.json";

/** Source of the last post timestamp */
export type LastPostSource = "state_file" | "new";

/** Persisted state structure */
export type PersistedState = {
  lastPostTimestamp: number | null;
  lastPostArtifactId: string | null;
  lastPostBotName: string | null;
  lastPostTitle: string | null;
};

/** Last post info with source */
export type LastPostInfo = {
  timestamp: number;
  artifactId: string | null;
  botName: string | null;
  title: string | null;
  source: LastPostSource;
};

/**
 * Lore state store for tracking post history
 */
class LoreStateStore {
  private readonly filePath: string;
  private readonly enablePersistence: boolean;

  private loaded = false;
  private dirty = false;

  private lastPostTimestamp: number | null = null;
  private lastPostArtifactId: string | null = null;
  private lastPostBotName: string | null = null;
  private lastPostTitle: string | null = null;

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
    if (parsed.lastPostTimestamp !== undefined) {
      this.lastPostTimestamp = parsed.lastPostTimestamp;
    }
    if (parsed.lastPostArtifactId !== undefined) {
      this.lastPostArtifactId = parsed.lastPostArtifactId;
    }
    if (parsed.lastPostBotName !== undefined) {
      this.lastPostBotName = parsed.lastPostBotName;
    }
    if (parsed.lastPostTitle !== undefined) {
      this.lastPostTitle = parsed.lastPostTitle;
    }
  }

  /**
   * Get the last post info
   */
  getLastPostInfo(): LastPostInfo | null {
    if (this.lastPostTimestamp === null) {
      return null;
    }

    return {
      timestamp: this.lastPostTimestamp,
      artifactId: this.lastPostArtifactId,
      botName: this.lastPostBotName,
      title: this.lastPostTitle,
      source: "state_file",
    };
  }

  /**
   * Record a new post
   */
  recordPost(info: {
    artifactId: string;
    botName: string;
    title: string;
  }): void {
    this.lastPostTimestamp = Math.floor(Date.now() / 1000);
    this.lastPostArtifactId = info.artifactId;
    this.lastPostBotName = info.botName;
    this.lastPostTitle = info.title;
    this.dirty = true;
  }

  /**
   * Flush state to disk
   */
  async flush(): Promise<void> {
    if (!(this.enablePersistence && this.dirty)) {
      return;
    }

    const state: PersistedState = {
      lastPostTimestamp: this.lastPostTimestamp,
      lastPostArtifactId: this.lastPostArtifactId,
      lastPostBotName: this.lastPostBotName,
      lastPostTitle: this.lastPostTitle,
    };

    try {
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true });
      await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
      this.dirty = false;
      log.debug(`State saved to ${this.filePath}`);
    } catch (error) {
      log.error("Failed to persist state:", error);
    }
  }
}

// Singleton store instance
let storeInstance: LoreStateStore | null = null;

/**
 * Get the default lore state store
 */
export const getLoreStateStore = (): LoreStateStore => {
  if (storeInstance) {
    return storeInstance;
  }

  const rootDir = process.cwd();
  const stateDir = process.env.STATE_DIR ?? DEFAULT_STATE_DIR;
  const filePath = join(rootDir, stateDir, STATE_FILE_NAME);

  const enablePersistence = process.env.NODE_ENV !== "test";

  storeInstance = new LoreStateStore({
    filePath,
    enablePersistence,
  });

  return storeInstance;
};

/**
 * Resolve the last post info from state
 */
export const resolveLastPostInfo = async (): Promise<LastPostInfo | null> => {
  const store = getLoreStateStore();
  await store.load();
  return store.getLastPostInfo();
};

/**
 * Record a lore post to state
 */
export const recordLorePost = async (info: {
  artifactId: string;
  botName: string;
  title: string;
}): Promise<void> => {
  const store = getLoreStateStore();
  store.recordPost(info);
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
