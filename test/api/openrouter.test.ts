import { generateLoreNarrative } from "../../src/api/openrouter";
import type { Artifact, Bot, BotStory, LoreContext } from "../../src/lib/types";

// Mock the OpenRouter SDK
jest.mock("@openrouter/sdk", () => ({
  OpenRouter: jest.fn().mockImplementation(() => ({
    chat: {
      send: jest.fn(),
    },
  })),
}));

import { OpenRouter } from "@openrouter/sdk";

const mockOpenRouter = OpenRouter as jest.MockedClass<typeof OpenRouter>;

describe("openrouter API", () => {
  const mockBot: Bot = {
    id: "bot-123",
    name: "Vector the Kind",
    tokenId: 123,
    traits: [
      { trait_type: "Background", value: "Blue" },
      { trait_type: "Class", value: "Warrior" },
    ],
    rarityRank: 500,
    unicode: {
      unicode: ["U+0041"],
      textContent: ["A"],
      colors: { background: "#000", text: "#fff" },
    },
    burnedAt: null,
    burnedBy: null,
  };

  const mockArtifact: Artifact = {
    id: "artifact-1",
    botTokenId: 123,
    imageUrl: "https://example.com/image.png",
    title: "Quantum Infiltrator",
    createdAt: "2024-01-01T00:00:00Z",
    mintedAt: "2024-01-02T00:00:00Z",
    contractTokenId: 456,
    mintQuantity: 1,
    minter: "0x1234",
  };

  const mockStory: BotStory = {
    arc: {
      id: "arc-1",
      title: "The Journey",
      role: "Warrior",
      faction: "The Order",
      mission: {
        type: "delivery",
        objective: "Deliver the artifact",
        setting: "Ancient ruins",
        threat: "Guardians",
        mechanic: "Stealth",
        timeContext: "Dawn",
        stakesSuccess: "Save the realm",
        stakesFailure: "Eternal darkness",
      },
      abilities: [
        {
          name: "Power Strike",
          effect: "Deal damage",
          cooldown: "30s",
          resource: "Energy",
        },
      ],
      symbolBias: ["⚔️"],
      environmentObjects: ["sword"],
      snippet: "A warrior...",
    },
    storySeed: 12_345,
    storyPowers: ["teleportation"],
    storyStats: { strength: 85 },
    storySnippet: "Personalized snippet",
    missionBrief: "Your mission...",
  };

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENROUTER_API_KEY = "test-api-key";
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateLoreNarrative", () => {
    it("should generate lore with story context", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "Generated narrative text about Vector the Kind...",
            },
          },
        ],
      };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      mockOpenRouter.mockImplementation(
        () =>
          ({
            chat: { send: mockSend },
          }) as unknown as InstanceType<typeof OpenRouter>
      );

      const context: LoreContext = {
        artifact: mockArtifact,
        bot: mockBot,
        story: mockStory,
      };

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Vector the Kind: Quantum Infiltrator");
      expect(result?.narrative).toContain("Generated narrative");
      expect(result?.bot).toEqual(mockBot);
      expect(result?.artifact).toEqual(mockArtifact);
    });

    it("should generate lore without story context", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: "Narrative without story context...",
            },
          },
        ],
      };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      mockOpenRouter.mockImplementation(
        () =>
          ({
            chat: { send: mockSend },
          }) as unknown as InstanceType<typeof OpenRouter>
      );

      const context: LoreContext = {
        artifact: mockArtifact,
        bot: mockBot,
        story: null,
      };

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      expect(result?.narrative).toContain("Narrative");
    });

    it("should return null when no content in response", async () => {
      const mockResponse = {
        choices: [{ message: { content: null } }],
      };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      mockOpenRouter.mockImplementation(
        () =>
          ({
            chat: { send: mockSend },
          }) as unknown as InstanceType<typeof OpenRouter>
      );

      const context: LoreContext = {
        artifact: mockArtifact,
        bot: mockBot,
        story: null,
      };

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should return null when choices array is empty", async () => {
      const mockResponse = { choices: [] };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      mockOpenRouter.mockImplementation(
        () =>
          ({
            chat: { send: mockSend },
          }) as unknown as InstanceType<typeof OpenRouter>
      );

      const context: LoreContext = {
        artifact: mockArtifact,
        bot: mockBot,
        story: null,
      };

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should return null on API error", async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error("API Error"));
      mockOpenRouter.mockImplementation(
        () =>
          ({
            chat: { send: mockSend },
          }) as unknown as InstanceType<typeof OpenRouter>
      );

      const context: LoreContext = {
        artifact: mockArtifact,
        bot: mockBot,
        story: null,
      };

      const result = await generateLoreNarrative(context);

      expect(result).toBeNull();
    });

    it("should handle array content type", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: [{ type: "text", text: "Text from array content" }],
            },
          },
        ],
      };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      mockOpenRouter.mockImplementation(
        () =>
          ({
            chat: { send: mockSend },
          }) as unknown as InstanceType<typeof OpenRouter>
      );

      const context: LoreContext = {
        artifact: mockArtifact,
        bot: mockBot,
        story: null,
      };

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      expect(result?.narrative).toBe("Text from array content");
    });

    it("should truncate long narratives", async () => {
      const longContent = "A".repeat(5000);
      const mockResponse = {
        choices: [{ message: { content: longContent } }],
      };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      mockOpenRouter.mockImplementation(
        () =>
          ({
            chat: { send: mockSend },
          }) as unknown as InstanceType<typeof OpenRouter>
      );

      const context: LoreContext = {
        artifact: mockArtifact,
        bot: mockBot,
        story: null,
      };

      const result = await generateLoreNarrative(context);

      expect(result).not.toBeNull();
      expect(result?.narrative.length).toBeLessThanOrEqual(4000);
      expect(result?.narrative.endsWith("...")).toBe(true);
    });

    it("should use custom model from env", async () => {
      process.env.OPENROUTER_MODEL = "openai/gpt-4o";

      const mockResponse = {
        choices: [{ message: { content: "Response" } }],
      };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      mockOpenRouter.mockImplementation(
        () =>
          ({
            chat: { send: mockSend },
          }) as unknown as InstanceType<typeof OpenRouter>
      );

      const context: LoreContext = {
        artifact: mockArtifact,
        bot: mockBot,
        story: null,
      };

      await generateLoreNarrative(context);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ model: "openai/gpt-4o" })
      );
    });
  });
});
