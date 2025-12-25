import type { LoreContext } from "../../src/lib/types";
import { generateLoreNarrative } from "../../src/lore/generate";
import {
  createBot,
  createLoreContext,
  REAL_ARTIFACT,
  REAL_BOT,
  REAL_BOT_STORY,
} from "../fixtures";

// Mock the Google AI module
jest.mock("../../src/api/google-ai", () => ({
  generateText: jest.fn(),
}));

import { generateText } from "../../src/api/google-ai";

const mockGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;

describe("Lore Generation", () => {
  const originalApiKey = process.env.GOOGLE_AI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_AI_API_KEY = "test-google-ai-key";
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.GOOGLE_AI_API_KEY = originalApiKey;
    } else {
      delete process.env.GOOGLE_AI_API_KEY;
    }
  });

  describe("generateLoreNarrative", () => {
    it("should generate lore with story context using real data", async () => {
      mockGenerateText.mockResolvedValue(
        "In the shadows of Black Site 7, Binarywire moved like a ghost..."
      );

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
      mockGenerateText.mockResolvedValue("A story without arc context...");

      const context = createLoreContext({
        story: null,
      });

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      expect(result?.narrative).toBe("A story without arc context...");
    });

    it("should handle bot with traits", async () => {
      mockGenerateText.mockResolvedValue("Narrative with traits...");

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
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Background: Cosmic"),
        })
      );
    });

    it("should include abilities in prompt when present", async () => {
      mockGenerateText.mockResolvedValue("Story with abilities...");

      const context: LoreContext = {
        artifact: REAL_ARTIFACT,
        bot: REAL_BOT,
        story: REAL_BOT_STORY,
      };

      await generateLoreNarrative(context);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("Shadow Merge"),
        })
      );
    });

    it("should return null when generateText returns null", async () => {
      mockGenerateText.mockResolvedValue(null);

      const context = createLoreContext();

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should return null when generateText throws an error", async () => {
      mockGenerateText.mockRejectedValue(new Error("API error"));

      const context = createLoreContext();

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should include mission details in prompt", async () => {
      mockGenerateText.mockResolvedValue("Mission-focused narrative...");

      const context: LoreContext = {
        artifact: REAL_ARTIFACT,
        bot: REAL_BOT,
        story: REAL_BOT_STORY,
      };

      await generateLoreNarrative(context);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(
            "Bypass 8 security scanners to reach central data vault"
          ),
        })
      );
    });

    it("should set appropriate temperature for creative output", async () => {
      mockGenerateText.mockResolvedValue("Creative narrative...");

      const context = createLoreContext();

      await generateLoreNarrative(context);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.8,
        })
      );
    });
  });
});
