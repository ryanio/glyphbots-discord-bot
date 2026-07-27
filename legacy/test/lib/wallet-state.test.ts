import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  getWalletStateStore,
  resetWalletStateStore,
  WalletStateStore,
} from "../../src/lib/wallet-state";

describe("WalletStateStore", () => {
  const testFilePath = join(__dirname, ".test-wallet-state.json");

  afterEach(async () => {
    resetWalletStateStore();
    try {
      await rm(testFilePath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe("in-memory operations", () => {
    it("stores and retrieves wallets", async () => {
      const store = new WalletStateStore({
        filePath: testFilePath,
        enablePersistence: false,
      });
      await store.load();

      store.setWallet("user123", "0x00A839dE7922491683f547a67795204763ff8237");
      expect(store.getWallet("user123")).toBe(
        "0x00a839de7922491683f547a67795204763ff8237"
      );
    });

    it("normalizes addresses to lowercase", () => {
      const store = new WalletStateStore({
        filePath: testFilePath,
        enablePersistence: false,
      });

      store.setWallet("user123", "0xABCDEF1234567890ABCDEF1234567890ABCDEF12");
      expect(store.getWallet("user123")).toBe(
        "0xabcdef1234567890abcdef1234567890abcdef12"
      );
    });

    it("clears wallets", () => {
      const store = new WalletStateStore({
        filePath: testFilePath,
        enablePersistence: false,
      });

      store.setWallet("user123", "0x1234");
      expect(store.clearWallet("user123")).toBe(true);
      expect(store.getWallet("user123")).toBeUndefined();
    });

    it("returns false when clearing non-existent wallet", () => {
      const store = new WalletStateStore({
        filePath: testFilePath,
        enablePersistence: false,
      });

      expect(store.clearWallet("nonexistent")).toBe(false);
    });

    it("counts wallets correctly", () => {
      const store = new WalletStateStore({
        filePath: testFilePath,
        enablePersistence: false,
      });

      expect(store.getWalletCount()).toBe(0);

      store.setWallet("user1", "0x1111");
      store.setWallet("user2", "0x2222");
      store.setWallet("user3", "0x3333");

      expect(store.getWalletCount()).toBe(3);
    });

    it("returns all wallets", () => {
      const store = new WalletStateStore({
        filePath: testFilePath,
        enablePersistence: false,
      });

      store.setWallet("user1", "0x1111");
      store.setWallet("user2", "0x2222");

      const all = store.getAllWallets();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all.user1).toBe("0x1111");
      expect(all.user2).toBe("0x2222");
    });

    it("resets state", () => {
      const store = new WalletStateStore({
        filePath: testFilePath,
        enablePersistence: false,
      });

      store.setWallet("user1", "0x1111");
      store.reset();

      expect(store.getWalletCount()).toBe(0);
      expect(store.getWallet("user1")).toBeUndefined();
    });
  });

  describe("singleton", () => {
    it("returns the same instance", () => {
      const store1 = getWalletStateStore();
      const store2 = getWalletStateStore();
      expect(store1).toBe(store2);
    });
  });
});
