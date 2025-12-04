import {
  delay,
  formatTimeAgo,
  formatTimestamp,
  getErrorMessage,
  loadConfig,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
  truncate,
  weightedRandomIndex,
} from "../../src/lib/utils";

describe("utils", () => {
  describe("loadConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should throw if DISCORD_TOKEN is missing", () => {
      process.env.LORE_CHANNEL_ID = "123";
      process.env.OPENROUTER_API_KEY = "key";
      process.env.DISCORD_TOKEN = undefined;

      expect(() => loadConfig()).toThrow(
        "DISCORD_TOKEN environment variable is required"
      );
    });

    it("should throw if LORE_CHANNEL_ID is missing", () => {
      process.env.DISCORD_TOKEN = "token";
      process.env.OPENROUTER_API_KEY = "key";
      process.env.LORE_CHANNEL_ID = undefined;

      expect(() => loadConfig()).toThrow(
        "LORE_CHANNEL_ID environment variable is required"
      );
    });

    it("should throw if OPENROUTER_API_KEY is missing", () => {
      process.env.DISCORD_TOKEN = "token";
      process.env.LORE_CHANNEL_ID = "123";
      process.env.OPENROUTER_API_KEY = undefined;

      expect(() => loadConfig()).toThrow(
        "OPENROUTER_API_KEY environment variable is required"
      );
    });

    it("should load config with defaults", () => {
      process.env.DISCORD_TOKEN = "test-token";
      process.env.LORE_CHANNEL_ID = "123456789";
      process.env.OPENROUTER_API_KEY = "test-key";

      const config = loadConfig();

      expect(config.discordToken).toBe("test-token");
      expect(config.loreChannelId).toBe("123456789");
      expect(config.openRouterApiKey).toBe("test-key");
      expect(config.loreIntervalMinutes).toBe(30);
      expect(config.openRouterModel).toBe("anthropic/claude-sonnet-4");
      expect(config.glyphbotsApiUrl).toBe("https://glyphbots.com");
      expect(config.logLevel).toBe("info");
    });

    it("should use custom values from env", () => {
      process.env.DISCORD_TOKEN = "test-token";
      process.env.LORE_CHANNEL_ID = "123456789";
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.LORE_INTERVAL_MINUTES = "15";
      process.env.OPENROUTER_MODEL = "openai/gpt-4o";
      process.env.GLYPHBOTS_API_URL = "https://custom.api.com";
      process.env.LOG_LEVEL = "debug";

      const config = loadConfig();

      expect(config.loreIntervalMinutes).toBe(15);
      expect(config.openRouterModel).toBe("openai/gpt-4o");
      expect(config.glyphbotsApiUrl).toBe("https://custom.api.com");
      expect(config.logLevel).toBe("debug");
    });
  });

  describe("delay", () => {
    it("should delay for specified milliseconds", async () => {
      const start = Date.now();
      await delay(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45);
      expect(elapsed).toBeLessThan(150);
    });
  });

  describe("formatTimestamp", () => {
    it("should format date as readable timestamp", () => {
      const date = new Date("2024-12-04T14:30:00.000Z");
      const result = formatTimestamp(date);

      expect(result).toContain("Dec");
      expect(result).toContain("4");
      expect(result).toContain("2024");
    });
  });

  describe("formatTimeAgo", () => {
    it("should return 'just now' for recent times", () => {
      const date = new Date();
      expect(formatTimeAgo(date)).toBe("just now");
    });

    it("should return minutes ago", () => {
      const date = new Date(
        Date.now() - 5 * MS_PER_SECOND * SECONDS_PER_MINUTE
      );
      expect(formatTimeAgo(date)).toBe("5 minutes ago");
    });

    it("should return hours ago", () => {
      const date = new Date(
        Date.now() - 3 * MS_PER_SECOND * SECONDS_PER_MINUTE * 60
      );
      expect(formatTimeAgo(date)).toBe("3 hours ago");
    });

    it("should return days ago", () => {
      const date = new Date(
        Date.now() - 2 * MS_PER_SECOND * SECONDS_PER_MINUTE * 60 * 24
      );
      expect(formatTimeAgo(date)).toBe("2 days ago");
    });

    it("should use singular for 1 minute", () => {
      const date = new Date(
        Date.now() - 1 * MS_PER_SECOND * SECONDS_PER_MINUTE
      );
      expect(formatTimeAgo(date)).toBe("1 minute ago");
    });

    it("should use singular for 1 hour", () => {
      const date = new Date(
        Date.now() - 1 * MS_PER_SECOND * SECONDS_PER_MINUTE * 60
      );
      expect(formatTimeAgo(date)).toBe("1 hour ago");
    });

    it("should use singular for 1 day", () => {
      const date = new Date(
        Date.now() - 1 * MS_PER_SECOND * SECONDS_PER_MINUTE * 60 * 24
      );
      expect(formatTimeAgo(date)).toBe("1 day ago");
    });
  });

  describe("weightedRandomIndex", () => {
    it("should return value between 1 and max", () => {
      for (let i = 0; i < 100; i++) {
        const result = weightedRandomIndex(100);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(100);
      }
    });

    it("should return 1 when max is 1", () => {
      expect(weightedRandomIndex(1)).toBe(1);
    });

    it("should favor higher values with default weight", () => {
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        results.push(weightedRandomIndex(100));
      }

      const average = results.reduce((a, b) => a + b, 0) / results.length;
      // With weight=2.0, average should be higher than uniform (50.5)
      expect(average).toBeGreaterThan(55);
    });
  });

  describe("truncate", () => {
    it("should return text unchanged if shorter than maxLength", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });

    it("should return text unchanged if equal to maxLength", () => {
      expect(truncate("hello", 5)).toBe("hello");
    });

    it("should truncate and add ellipsis if longer than maxLength", () => {
      expect(truncate("hello world", 8)).toBe("hello...");
    });

    it("should handle empty string", () => {
      expect(truncate("", 10)).toBe("");
    });
  });

  describe("getErrorMessage", () => {
    it("should extract message from Error instance", () => {
      const error = new Error("test error");
      expect(getErrorMessage(error)).toBe("test error");
    });

    it("should convert string to string", () => {
      expect(getErrorMessage("string error")).toBe("string error");
    });

    it("should convert number to string", () => {
      expect(getErrorMessage(404)).toBe("404");
    });

    it("should convert object to string", () => {
      expect(getErrorMessage({ code: "ERR" })).toBe("[object Object]");
    });

    it("should handle null", () => {
      expect(getErrorMessage(null)).toBe("null");
    });

    it("should handle undefined", () => {
      expect(getErrorMessage(undefined)).toBe("undefined");
    });
  });

  describe("constants", () => {
    it("should have correct MS_PER_SECOND", () => {
      expect(MS_PER_SECOND).toBe(1000);
    });

    it("should have correct SECONDS_PER_MINUTE", () => {
      expect(SECONDS_PER_MINUTE).toBe(60);
    });
  });
});
