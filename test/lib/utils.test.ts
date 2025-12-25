import {
  formatTimeAgo,
  getErrorMessage,
  loadConfig,
  timeout,
  weightedRandomIndex,
} from "../../src/lib/utils";
import { clearTestEnv, setupTestEnv, TEST_CONFIG } from "../fixtures";

describe("utils", () => {
  describe("loadConfig", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      setupTestEnv();
    });

    afterEach(() => {
      clearTestEnv();
      process.env = { ...originalEnv };
    });

    it("should load config from environment variables", () => {
      const config = loadConfig();

      expect(config.discordToken).toBe(TEST_CONFIG.discordToken);
      expect(config.loreChannelId).toBe(TEST_CONFIG.loreChannelId);
      expect(config.googleAiApiKey).toBe(TEST_CONFIG.googleAiApiKey);
    });

    it("should use default values when optional env vars not set", () => {
      delete process.env.LORE_MIN_INTERVAL_MINUTES;
      delete process.env.LORE_MAX_INTERVAL_MINUTES;

      const config = loadConfig();

      expect(config.loreMinIntervalMinutes).toBe(240);
      expect(config.loreMaxIntervalMinutes).toBe(720);
    });

    it("should parse LORE_MIN_INTERVAL_MINUTES and LORE_MAX_INTERVAL_MINUTES as numbers", () => {
      process.env.LORE_MIN_INTERVAL_MINUTES = "120";
      process.env.LORE_MAX_INTERVAL_MINUTES = "480";

      const config = loadConfig();

      expect(config.loreMinIntervalMinutes).toBe(120);
      expect(config.loreMaxIntervalMinutes).toBe(480);
    });

    it("should throw when DISCORD_TOKEN is missing", () => {
      delete process.env.DISCORD_TOKEN;

      expect(() => loadConfig()).toThrow("DISCORD_TOKEN");
    });

    it("should throw when LORE_CHANNEL_ID is missing", () => {
      delete process.env.LORE_CHANNEL_ID;

      expect(() => loadConfig()).toThrow("LORE_CHANNEL_ID");
    });

    it("should throw when GOOGLE_AI_API_KEY is missing", () => {
      delete process.env.GOOGLE_AI_API_KEY;

      expect(() => loadConfig()).toThrow("GOOGLE_AI_API_KEY");
    });

    it("should use custom GLYPHBOTS_API_URL when set", () => {
      process.env.GLYPHBOTS_API_URL = "https://custom.api.com";

      const config = loadConfig();

      expect(config.glyphbotsApiUrl).toBe("https://custom.api.com");
    });

    it("should use custom LOG_LEVEL when set", () => {
      process.env.LOG_LEVEL = "debug";

      const config = loadConfig();

      expect(config.logLevel).toBe("debug");
    });
  });

  describe("formatTimeAgo", () => {
    it("should format seconds ago", () => {
      const now = Date.now();
      const thirtySecondsAgo = new Date(now - 30 * 1000).toISOString();

      const result = formatTimeAgo(thirtySecondsAgo);

      expect(result).toBe("30 seconds ago");
    });

    it("should format minutes ago", () => {
      const now = Date.now();
      const fiveMinutesAgo = new Date(now - 5 * 60 * 1000).toISOString();

      const result = formatTimeAgo(fiveMinutesAgo);

      expect(result).toBe("5 minutes ago");
    });

    it("should format hours ago", () => {
      const now = Date.now();
      const threeHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString();

      const result = formatTimeAgo(threeHoursAgo);

      expect(result).toBe("3 hours ago");
    });

    it("should format days ago", () => {
      const now = Date.now();
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

      const result = formatTimeAgo(twoDaysAgo);

      expect(result).toBe("2 days ago");
    });

    it("should use singular form for 1 unit", () => {
      const now = Date.now();
      const oneMinuteAgo = new Date(now - 60 * 1000).toISOString();

      const result = formatTimeAgo(oneMinuteAgo);

      expect(result).toBe("1 minute ago");
    });
  });

  describe("getErrorMessage", () => {
    it("should extract message from Error object", () => {
      const error = new Error("Test error message");

      const result = getErrorMessage(error);

      expect(result).toBe("Test error message");
    });

    it("should convert string to message", () => {
      const result = getErrorMessage("String error");

      expect(result).toBe("String error");
    });

    it("should convert number to message", () => {
      const result = getErrorMessage(404);

      expect(result).toBe("404");
    });

    it("should handle null", () => {
      const result = getErrorMessage(null);

      expect(result).toBe("Unknown error");
    });

    it("should handle undefined", () => {
      const result = getErrorMessage(undefined);

      expect(result).toBe("Unknown error");
    });

    it("should handle objects with toString", () => {
      const obj = { toString: () => "Custom object error" };

      const result = getErrorMessage(obj);

      expect(result).toBe("Custom object error");
    });
  });

  describe("timeout", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should resolve after specified milliseconds", async () => {
      const promise = timeout(1000);

      jest.advanceTimersByTime(1000);

      await expect(promise).resolves.toBeUndefined();
    });

    it("should not resolve before timeout", () => {
      let resolved = false;

      timeout(1000).then(() => {
        resolved = true;
      });

      jest.advanceTimersByTime(500);

      expect(resolved).toBe(false);
    });
  });

  describe("weightedRandomIndex", () => {
    it("should return 0 for single item array", () => {
      const result = weightedRandomIndex(1);

      expect(result).toBe(0);
    });

    it("should return valid index for array of length 2", () => {
      const result = weightedRandomIndex(2);

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(2);
    });

    it("should return valid index for large array", () => {
      const length = 100;
      const result = weightedRandomIndex(length);

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(length);
    });

    it("should favor lower indices over multiple runs", () => {
      const length = 10;
      const iterations = 1000;
      const counts = new Array<number>(length).fill(0);

      for (let i = 0; i < iterations; i++) {
        const index = weightedRandomIndex(length);
        counts[index] += 1;
      }

      // First half should have more selections than second half on average
      const firstHalfSum = counts.slice(0, 5).reduce((a, b) => a + b, 0);
      const secondHalfSum = counts.slice(5).reduce((a, b) => a + b, 0);

      expect(firstHalfSum).toBeGreaterThan(secondHalfSum);
    });

    it("should handle edge case of length 0", () => {
      const result = weightedRandomIndex(0);

      expect(result).toBe(0);
    });
  });
});
