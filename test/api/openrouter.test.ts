import { generateLoreNarrative } from "../../src/api/openrouter";
import type { LoreContext } from "../../src/lib/types";
import {
  createBot,
  createChatResponse,
  createLoreContext,
  REAL_ARTIFACT,
  REAL_BOT,
  REAL_BOT_STORY,
} from "../fixtures";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

/** Helper to extract request body from fetch call */
const getRequestBody = (call: unknown[]): Record<string, unknown> => {
  const init = call.at(1) as RequestInit | undefined;
  return JSON.parse(init?.body as string) as Record<string, unknown>;
};

/** Helper to extract text content from messages in request body */
const extractUserTextContent = (body: Record<string, unknown>): string => {
  const messages = body.messages as Array<{
    role: string;
    content: unknown;
  }>;
  const userMsg = messages.find((m) => m.role === "user");
  if (!userMsg) {
    return "";
  }
  const content = userMsg.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (p): p is { type: "text"; text: string } =>
          typeof p === "object" && p.type === "text"
      )
      .map((p) => p.text)
      .join("");
  }
  return "";
};

describe("OpenRouter API", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "test-api-key";
    process.env.OPENROUTER_MODEL = "anthropic/claude-sonnet-4";
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    if (originalModel !== undefined) {
      process.env.OPENROUTER_MODEL = originalModel;
    } else {
      delete process.env.OPENROUTER_MODEL;
    }
  });

  describe("generateLoreNarrative", () => {
    it("should generate lore with story context using real data", async () => {
      const mockResponse = createChatResponse(
        "In the shadows of Black Site 7, Binarywire moved like a ghost through the digital ether..."
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const context: LoreContext = {
        artifact: REAL_ARTIFACT,
        bot: REAL_BOT,
        story: REAL_BOT_STORY,
      };

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Binarywire: Stealth Infiltration Specialist");
      expect(result?.narrative).toContain("Black Site 7");
      expect(result?.bot).toEqual(REAL_BOT);
      expect(result?.artifact).toEqual(REAL_ARTIFACT);
    });

    it("should generate lore without story context", async () => {
      const mockResponse = createChatResponse("A story without arc context...");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const context = createLoreContext({
        story: null,
      });

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      expect(result?.narrative).toBe("A story without arc context...");
    });

    it("should handle bot with traits", async () => {
      const mockResponse = createChatResponse("Narrative with traits...");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const bot = createBot({
        name: "TraitBot",
        traits: [
          { trait_type: "Background", value: "Cosmic" },
          { trait_type: "Weapon", value: "Laser" },
        ],
      });

      const context = createLoreContext({ bot });

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      const body = getRequestBody(mockFetch.mock.calls.at(0) ?? []);
      const textContent = extractUserTextContent(body);
      expect(textContent).toContain("Background: Cosmic");
    });

    it("should include abilities in prompt when present", async () => {
      const mockResponse = createChatResponse("Story with abilities...");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const context: LoreContext = {
        artifact: REAL_ARTIFACT,
        bot: REAL_BOT,
        story: REAL_BOT_STORY,
      };

      await generateLoreNarrative(context);

      const body = getRequestBody(mockFetch.mock.calls.at(0) ?? []);
      const textContent = extractUserTextContent(body);
      expect(textContent).toContain("Shadow Merge");
    });

    it("should return null when no content in response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: null } }],
        }),
      });

      const context = createLoreContext();

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should return null when choices array is empty", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [],
        }),
      });

      const context = createLoreContext();

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should return null when API throws an error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const context = createLoreContext();

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should return null when OPENROUTER_API_KEY is not set", async () => {
      delete process.env.OPENROUTER_API_KEY;

      const context = createLoreContext();

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should handle array content type in response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "Part 1 of the story. " },
                  { type: "text", text: "Part 2 of the story." },
                ],
              },
            },
          ],
        }),
      });

      const context = createLoreContext();

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      expect(result?.narrative).toBe(
        "Part 1 of the story. Part 2 of the story."
      );
    });

    it("should use correct model from environment", async () => {
      process.env.OPENROUTER_MODEL = "openai/gpt-4";

      const mockResponse = createChatResponse("Response from GPT-4...");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const context = createLoreContext();

      await generateLoreNarrative(context);

      const body = getRequestBody(mockFetch.mock.calls.at(0) ?? []);
      expect(body.model).toBe("openai/gpt-4");
    });

    it("should use default model when not specified", async () => {
      delete process.env.OPENROUTER_MODEL;

      const mockResponse = createChatResponse("Response from default model...");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const context = createLoreContext();

      await generateLoreNarrative(context);

      const body = getRequestBody(mockFetch.mock.calls.at(0) ?? []);
      expect(body.model).toBe("anthropic/claude-sonnet-4");
    });

    it("should trim whitespace from response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "  Narrative with whitespace  \n\n",
              },
            },
          ],
        }),
      });

      const context = createLoreContext();

      const result = await generateLoreNarrative(context);

      expect(result?.narrative).toBe("Narrative with whitespace");
    });

    it("should include mission details in prompt", async () => {
      const mockResponse = createChatResponse("Mission-focused narrative...");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const context: LoreContext = {
        artifact: REAL_ARTIFACT,
        bot: REAL_BOT,
        story: REAL_BOT_STORY,
      };

      await generateLoreNarrative(context);

      const body = getRequestBody(mockFetch.mock.calls.at(0) ?? []);
      const textContent = extractUserTextContent(body);
      expect(textContent).toContain(
        "Bypass 8 security scanners to reach central data vault"
      );
    });

    it("should set appropriate temperature for creative output", async () => {
      const mockResponse = createChatResponse("Creative narrative...");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const context = createLoreContext();

      await generateLoreNarrative(context);

      const body = getRequestBody(mockFetch.mock.calls.at(0) ?? []);
      expect(body.temperature).toBe(0.8);
    });

    it("should send authorization header", async () => {
      const mockResponse = createChatResponse("Test...");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const context = createLoreContext();

      await generateLoreNarrative(context);

      const init = mockFetch.mock.calls.at(0)?.at(1) as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-api-key");
    });
  });
});
