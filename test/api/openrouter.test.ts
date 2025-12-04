import {
  extractResponseContent,
  generateText,
  sendChatCompletion,
} from "../../src/api/openrouter";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("OpenRouter API", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "test-api-key";
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  describe("sendChatCompletion", () => {
    it("should send request with correct headers", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "test" } }] }),
      });

      await sendChatCompletion({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      });

      const init = mockFetch.mock.calls.at(0)?.at(1) as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-api-key");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("should send correct body parameters", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "test" } }] }),
      });

      await sendChatCompletion({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
        maxTokens: 1000,
        temperature: 0.5,
      });

      const init = mockFetch.mock.calls.at(0)?.at(1) as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("test-model");
      expect(body.max_tokens).toBe(1000);
      expect(body.temperature).toBe(0.5);
    });

    it("should throw when API key is not set", async () => {
      delete process.env.OPENROUTER_API_KEY;

      await expect(
        sendChatCompletion({
          model: "test-model",
          messages: [{ role: "user", content: "hello" }],
        })
      ).rejects.toThrow("OPENROUTER_API_KEY");
    });

    it("should throw on API error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(
        sendChatCompletion({
          model: "test-model",
          messages: [{ role: "user", content: "hello" }],
        })
      ).rejects.toThrow("OpenRouter API error: 500");
    });
  });

  describe("extractResponseContent", () => {
    it("should extract string content", () => {
      const response = {
        choices: [{ message: { content: "Hello world" } }],
      };

      expect(extractResponseContent(response)).toBe("Hello world");
    });

    it("should extract array content", () => {
      const response = {
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "Part 1. " },
                { type: "text", text: "Part 2." },
              ],
            },
          },
        ],
      };

      expect(extractResponseContent(response)).toBe("Part 1. Part 2.");
    });

    it("should return null for empty choices", () => {
      expect(extractResponseContent({ choices: [] })).toBeNull();
    });

    it("should return null for missing content", () => {
      const response = {
        choices: [{ message: {} }],
      };

      expect(extractResponseContent(response)).toBeNull();
    });
  });

  describe("generateText", () => {
    it("should return trimmed content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "  Hello world  \n" } }],
        }),
      });

      const result = await generateText({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result).toBe("Hello world");
    });

    it("should return null on API error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Error",
      });

      const result = await generateText({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result).toBeNull();
    });

    it("should return null when no content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [] }),
      });

      const result = await generateText({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result).toBeNull();
    });
  });
});
