import type { Client } from "discord.js";
import {
  fetchBot,
  fetchBotStory,
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../../src/api/glyphbots";
import { generateLoreNarrative } from "../../src/api/openrouter";
import { initLoreChannel } from "../../src/channels/lore";
import type { Artifact, Bot, BotStory, Config } from "../../src/lib/types";

// Mock the API modules
jest.mock("../../src/api/glyphbots");
jest.mock("../../src/api/openrouter");

const mockFetchRecentArtifacts = fetchRecentArtifacts as jest.MockedFunction<
  typeof fetchRecentArtifacts
>;
const mockFetchBot = fetchBot as jest.MockedFunction<typeof fetchBot>;
const mockFetchBotStory = fetchBotStory as jest.MockedFunction<
  typeof fetchBotStory
>;
const mockGetBotUrl = getBotUrl as jest.MockedFunction<typeof getBotUrl>;
const mockGetArtifactUrl = getArtifactUrl as jest.MockedFunction<
  typeof getArtifactUrl
>;
const mockGenerateLoreNarrative = generateLoreNarrative as jest.MockedFunction<
  typeof generateLoreNarrative
>;

describe("lore channel", () => {
  const mockBot: Bot = {
    id: "bot-123",
    name: "Vector the Kind",
    tokenId: 123,
    traits: [{ trait_type: "Background", value: "Blue" }],
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
      abilities: [],
      symbolBias: [],
      environmentObjects: [],
      snippet: "A warrior...",
    },
    storySeed: 12_345,
    storyPowers: [],
    storyStats: {},
    storySnippet: "Snippet",
    missionBrief: "Mission",
  };

  const mockConfig: Config = {
    discordToken: "test-token",
    loreChannelId: "123456789",
    loreIntervalMinutes: 30,
    openRouterApiKey: "test-key",
    openRouterModel: "anthropic/claude-sonnet-4",
    glyphbotsApiUrl: "https://glyphbots.com",
    logLevel: "info",
  };

  let mockChannel: {
    id: string;
    name: string;
    isTextBased: () => boolean;
    isSendable: () => boolean;
    send: jest.Mock;
  };
  let mockClient: Partial<Client>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockChannel = {
      id: "123456789",
      name: "lore",
      isTextBased: () => true,
      isSendable: () => true,
      send: jest.fn().mockResolvedValue({}),
    };

    mockClient = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      } as unknown as Client["channels"],
    };

    // Default mock implementations
    mockFetchRecentArtifacts.mockResolvedValue([mockArtifact]);
    mockFetchBot.mockResolvedValue(mockBot);
    mockFetchBotStory.mockResolvedValue(mockStory);
    mockGetBotUrl.mockReturnValue("https://glyphbots.com/bot/123");
    mockGetArtifactUrl.mockReturnValue(
      "https://glyphbots.com/artifact/artifact-1"
    );

    mockGenerateLoreNarrative.mockResolvedValue({
      title: "Vector the Kind: Quantum Infiltrator",
      narrative: "Generated story narrative...",
      artifact: mockArtifact,
      bot: mockBot,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("initLoreChannel", () => {
    it("should fetch the channel from client", async () => {
      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockClient.channels?.fetch).toHaveBeenCalledWith("123456789");
    });

    it("should throw if channel is not text-based", async () => {
      mockClient.channels = {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => false,
        }),
      } as unknown as Client["channels"];

      await expect(
        initLoreChannel(mockClient as Client, mockConfig)
      ).rejects.toThrow("is not a text channel");
    });

    it("should post initial lore entry", async () => {
      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockFetchRecentArtifacts).toHaveBeenCalled();
      expect(mockFetchBot).toHaveBeenCalledWith(123);
      expect(mockGenerateLoreNarrative).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalled();
    });

    it("should set up interval for recurring posts", async () => {
      await initLoreChannel(mockClient as Client, mockConfig);

      // Clear initial calls
      jest.clearAllMocks();

      // Fast-forward 30 minutes
      jest.advanceTimersByTime(30 * 60 * 1000);

      // Should trigger another post
      expect(mockFetchRecentArtifacts).toHaveBeenCalled();
    });

    it("should handle channel fetch error gracefully", async () => {
      mockClient.channels = {
        fetch: jest.fn().mockResolvedValue(null),
      } as unknown as Client["channels"];

      await expect(
        initLoreChannel(mockClient as Client, mockConfig)
      ).rejects.toThrow();
    });
  });

  describe("weighted artifact selection", () => {
    it("should call fetchRecentArtifacts", async () => {
      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockFetchRecentArtifacts).toHaveBeenCalledWith(50);
    });

    it("should handle empty artifacts list", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([]);

      await initLoreChannel(mockClient as Client, mockConfig);

      // Should not crash, but won't post
      expect(mockChannel.send).not.toHaveBeenCalled();
    });
  });

  describe("lore context building", () => {
    it("should fetch bot data for artifact", async () => {
      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockFetchBot).toHaveBeenCalledWith(mockArtifact.botTokenId);
    });

    it("should fetch bot story", async () => {
      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockFetchBotStory).toHaveBeenCalledWith(mockArtifact.botTokenId);
    });

    it("should handle bot fetch failure with retry", async () => {
      mockFetchBot.mockResolvedValueOnce(null);
      mockFetchBot.mockResolvedValueOnce(mockBot);

      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockFetchBot).toHaveBeenCalledTimes(2);
    });

    it("should proceed without story data", async () => {
      mockFetchBotStory.mockResolvedValue(null);

      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockGenerateLoreNarrative).toHaveBeenCalledWith(
        expect.objectContaining({ story: null })
      );
    });
  });

  describe("embed generation", () => {
    it("should send embed to channel", async () => {
      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("should handle lore generation failure", async () => {
      mockGenerateLoreNarrative.mockResolvedValue(null);

      await initLoreChannel(mockClient as Client, mockConfig);

      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it("should not crash on send failure", async () => {
      (mockChannel.send as jest.Mock).mockRejectedValue(
        new Error("Send failed")
      );

      // Should not throw
      await initLoreChannel(mockClient as Client, mockConfig);
    });
  });

  describe("duplicate prevention", () => {
    it("should track posted artifacts", async () => {
      // Post initial
      await initLoreChannel(mockClient as Client, mockConfig);

      // Clear and advance timer
      jest.clearAllMocks();
      jest.advanceTimersByTime(30 * 60 * 1000);

      // Should still fetch artifacts
      expect(mockFetchRecentArtifacts).toHaveBeenCalled();
    });
  });
});
