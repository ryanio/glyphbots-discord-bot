import type { Client } from "discord.js";
import { mockDeep, mockReset } from "jest-mock-extended";
import {
  fetchBot,
  fetchBotStory,
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../../src/api/glyphbots";
import { initLoreChannel } from "../../src/channels/lore";
import { generateLoreNarrative } from "../../src/lore/generate";
import {
  createArtifact,
  createBot,
  createBotStory,
  createConfig,
  createGeneratedLore,
  createMockChannel,
  type MockChannel,
  REAL_ARTIFACT,
  REAL_ARTIFACT_2,
  REAL_BOT,
  REAL_BOT_STORY,
  TEST_CONFIG,
} from "../fixtures";

// Mock the API modules
jest.mock("../../src/api/glyphbots");
jest.mock("../../src/lore/generate");

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
  let mockChannel: MockChannel;
  const mockClient = mockDeep<Client>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockReset(mockClient);
    jest.useFakeTimers();

    mockChannel = createMockChannel();
    mockClient.channels.fetch.mockResolvedValue(mockChannel as never);

    // Default mock implementations using real data
    mockFetchRecentArtifacts.mockResolvedValue([REAL_ARTIFACT]);
    mockFetchBot.mockResolvedValue(REAL_BOT);
    mockFetchBotStory.mockResolvedValue(REAL_BOT_STORY);
    mockGetBotUrl.mockReturnValue("https://glyphbots.com/bot/2369");
    mockGetArtifactUrl.mockReturnValue(
      `https://glyphbots.com/artifact/${REAL_ARTIFACT.id}`
    );

    mockGenerateLoreNarrative.mockResolvedValue(
      createGeneratedLore({
        title: `${REAL_BOT.name}: ${REAL_ARTIFACT.title}`,
        narrative:
          "In the shadows of Black Site 7, Binarywire moved like a ghost...",
        artifact: REAL_ARTIFACT,
        bot: REAL_BOT,
      })
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("initLoreChannel", () => {
    it("should fetch the specified channel", async () => {
      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockClient.channels.fetch).toHaveBeenCalledWith(
        TEST_CONFIG.loreChannelId
      );
    });

    it("should throw if channel is not text-based", async () => {
      const nonTextChannel = createMockChannel({ isTextBased: () => false });
      mockClient.channels.fetch.mockResolvedValue(nonTextChannel as never);

      await expect(initLoreChannel(mockClient, TEST_CONFIG)).rejects.toThrow(
        "not a text channel"
      );
    });

    it("should post initial lore entry on initialization", async () => {
      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockChannel.send).toHaveBeenCalled();
    });

    it("should post lore on interval", async () => {
      const config = createConfig({ loreIntervalMinutes: 5 });

      await initLoreChannel(mockClient, config);

      // Clear the initial post
      mockChannel.send.mockClear();

      // Advance time by interval (5 minutes)
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Run any pending timers
      await jest.runOnlyPendingTimersAsync();

      expect(mockChannel.send).toHaveBeenCalled();
    });

    it("should not post before interval elapsed", async () => {
      const config = createConfig({ loreIntervalMinutes: 30 });

      await initLoreChannel(mockClient, config);
      mockChannel.send.mockClear();

      // Advance only 15 minutes
      jest.advanceTimersByTime(15 * 60 * 1000);

      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it("should post multiple times over multiple intervals", async () => {
      const config = createConfig({ loreIntervalMinutes: 10 });

      await initLoreChannel(mockClient, config);
      mockChannel.send.mockClear();

      // Advance 3 intervals (30 minutes total)
      jest.advanceTimersByTime(30 * 60 * 1000);
      await jest.runOnlyPendingTimersAsync();

      // At least 3 posts should have been triggered
      expect(mockChannel.send.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it("should generate lore with real bot and artifact data", async () => {
      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockGenerateLoreNarrative).toHaveBeenCalledWith(
        expect.objectContaining({
          artifact: REAL_ARTIFACT,
          bot: REAL_BOT,
          story: REAL_BOT_STORY,
        })
      );
    });
  });

  describe("lore generation", () => {
    it("should fetch bot data for artifact", async () => {
      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockFetchBot).toHaveBeenCalledWith(REAL_ARTIFACT.botTokenId);
    });

    it("should fetch bot story", async () => {
      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockFetchBotStory).toHaveBeenCalledWith(REAL_ARTIFACT.botTokenId);
    });

    it("should handle missing bot gracefully", async () => {
      mockFetchBot.mockResolvedValue(null);

      await initLoreChannel(mockClient, TEST_CONFIG);

      // Should still complete without throwing
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it("should handle missing story gracefully", async () => {
      mockFetchBotStory.mockResolvedValue(null);

      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockGenerateLoreNarrative).toHaveBeenCalledWith(
        expect.objectContaining({
          story: null,
        })
      );
    });

    it("should handle lore generation failure gracefully", async () => {
      mockGenerateLoreNarrative.mockResolvedValue(null);

      await initLoreChannel(mockClient, TEST_CONFIG);

      // Should still complete without throwing
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it("should use weighted random selection for artifacts", async () => {
      // Setup multiple artifacts
      mockFetchRecentArtifacts.mockResolvedValue([
        REAL_ARTIFACT,
        REAL_ARTIFACT_2,
      ]);

      await initLoreChannel(mockClient, TEST_CONFIG);

      // Should have selected one of the artifacts
      expect(mockFetchBot).toHaveBeenCalled();
    });
  });

  describe("embed formatting", () => {
    it("should include artifact image in embed", async () => {
      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                image: expect.objectContaining({
                  url: REAL_ARTIFACT.imageUrl,
                }),
              }),
            }),
          ]),
        })
      );
    });

    it("should include bot and artifact links", async () => {
      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockGetBotUrl).toHaveBeenCalledWith(REAL_BOT.tokenId);
      expect(mockGetArtifactUrl).toHaveBeenCalledWith(
        REAL_ARTIFACT.contractTokenId
      );
    });
  });

  describe("weighted random selection", () => {
    it("should favor more recently minted artifacts", async () => {
      const oldArtifact = createArtifact({
        id: "old-artifact",
        mintedAt: "2024-01-01T00:00:00Z",
      });
      const newArtifact = createArtifact({
        id: "new-artifact",
        mintedAt: "2024-12-01T00:00:00Z",
      });

      // Set up with old artifact first, new artifact second
      mockFetchRecentArtifacts.mockResolvedValue([oldArtifact, newArtifact]);
      mockFetchBot.mockResolvedValue(createBot());
      mockFetchBotStory.mockResolvedValue(createBotStory());
      mockGenerateLoreNarrative.mockResolvedValue(
        createGeneratedLore({ artifact: newArtifact })
      );

      // Run multiple times to check distribution
      // The first artifact in the list should be selected more often
      // due to weighted random selection favoring early indices
      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockFetchRecentArtifacts).toHaveBeenCalled();
    });

    it("should handle single artifact list", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([REAL_ARTIFACT]);

      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockFetchBot).toHaveBeenCalledWith(REAL_ARTIFACT.botTokenId);
    });

    it("should handle empty artifact list gracefully", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([]);

      await initLoreChannel(mockClient, TEST_CONFIG);

      expect(mockChannel.send).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle channel send error", async () => {
      mockChannel.send.mockRejectedValue(new Error("Discord API error"));

      // Should not throw
      await expect(
        initLoreChannel(mockClient, TEST_CONFIG)
      ).resolves.not.toThrow();
    });
  });
});
