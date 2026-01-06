import { dirname, join } from "node:path";
import { ensureDirectory, readFileText, writeFileText } from "./fs";
import { prefixedLogger } from "./logger";

const log = prefixedLogger("WalletState");

const DEFAULT_STATE_DIR = ".state";
const WALLET_STATE_FILE_NAME = "wallet-state.json";

type WalletStateData = {
  wallets: Record<string, string>;
};

const emptyWalletState = (): WalletStateData => ({
  wallets: {},
});

class WalletStateStore {
  private readonly filePath: string;
  private readonly enablePersistence: boolean;

  private loaded = false;
  private dirty = false;

  private state: WalletStateData = emptyWalletState();

  constructor(options: { filePath: string; enablePersistence: boolean }) {
    this.filePath = options.filePath;
    this.enablePersistence = options.enablePersistence;
  }

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

  private async loadFromDisk(): Promise<void> {
    try {
      const content = await this.readStateFile();
      if (!content) {
        return;
      }

      const parsed = JSON.parse(content) as Partial<WalletStateData>;
      if (parsed.wallets) {
        this.state.wallets = parsed.wallets;
      }
      log.debug(`Loaded wallet state from ${this.filePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.debug("Failed to load wallet state:", error);
      }
    }
  }

  private async readStateFile(): Promise<string | undefined> {
    const dir = dirname(this.filePath);
    await ensureDirectory(dir);
    return readFileText(this.filePath);
  }

  getWallet(userId: string): string | undefined {
    return this.state.wallets[userId];
  }

  setWallet(userId: string, address: string): void {
    this.state.wallets[userId] = address.toLowerCase();
    this.dirty = true;
    log.debug(`Set wallet for ${userId}: ${address}`);
  }

  clearWallet(userId: string): boolean {
    if (this.state.wallets[userId]) {
      delete this.state.wallets[userId];
      this.dirty = true;
      log.debug(`Cleared wallet for ${userId}`);
      return true;
    }
    return false;
  }

  async flush(): Promise<void> {
    if (!(this.enablePersistence && this.dirty)) {
      return;
    }

    try {
      const dir = dirname(this.filePath);
      await ensureDirectory(dir);
      await writeFileText(this.filePath, JSON.stringify(this.state, null, 2));
      this.dirty = false;
      log.debug(`Wallet state saved to ${this.filePath}`);
    } catch (error) {
      log.error("Failed to persist wallet state:", error);
    }
  }

  getAllWallets(): Record<string, string> {
    return { ...this.state.wallets };
  }

  getWalletCount(): number {
    return Object.keys(this.state.wallets).length;
  }

  reset(): void {
    this.state = emptyWalletState();
    this.dirty = false;
    this.loaded = false;
  }
}

let storeInstance: WalletStateStore | null = null;

export const getWalletStateStore = (): WalletStateStore => {
  if (storeInstance) {
    return storeInstance;
  }

  const rootDir = process.cwd();
  const stateDir = process.env.STATE_DIR ?? DEFAULT_STATE_DIR;
  const filePath = join(rootDir, stateDir, WALLET_STATE_FILE_NAME);

  const enablePersistence = process.env.NODE_ENV !== "test";

  storeInstance = new WalletStateStore({
    filePath,
    enablePersistence,
  });

  return storeInstance;
};

export const getUserWallet = async (
  userId: string
): Promise<string | undefined> => {
  const store = getWalletStateStore();
  await store.load();
  return store.getWallet(userId);
};

export const setUserWallet = async (
  userId: string,
  address: string
): Promise<void> => {
  const store = getWalletStateStore();
  await store.load();
  store.setWallet(userId, address);
  await store.flush();
};

export const clearUserWallet = async (userId: string): Promise<boolean> => {
  const store = getWalletStateStore();
  await store.load();
  const cleared = store.clearWallet(userId);
  await store.flush();
  return cleared;
};

export const resetWalletStateStore = (): void => {
  storeInstance = null;
};

export { WalletStateStore };
