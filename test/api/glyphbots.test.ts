import {
  fetchArtifact,
  fetchArtifactsSummary,
  fetchBot,
  fetchBotStory,
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../../src/api/glyphbots";
import type {
  Artifact,
  ArtifactResponse,
  ArtifactsListResponse,
  ArtifactsSummaryResponse,
  Bot,
  BotResponse,
  BotStory,
  BotStoryResponse,
} from "../../src/lib/types";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("glyphbots API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("fetchArtifactsSummary", () => {
    it("should fetch and return summary data", async () => {
      const mockSummary: ArtifactsSummaryResponse = {
        total: 1000,
        last1d: 50,
        last7d: 200,
        last30d: 500,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSummary,
      });

      const result = await fetchArtifactsSummary();

      expect(result).toEqual(mockSummary);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/artifacts/recently-minted?summary=true"),
        expect.any(Object)
      );
    });

    it("should return null on fetch error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await fetchArtifactsSummary();

      expect(result).toBeNull();
    });

    it("should return null on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await fetchArtifactsSummary();

      expect(result).toBeNull();
    });
  });

  describe("fetchRecentArtifacts", () => {
    const mockArtifact: Artifact = {
      id: "artifact-1",
      botTokenId: 123,
      imageUrl: "https://example.com/image.png",
      title: "Test Artifact",
      createdAt: "2024-01-01T00:00:00Z",
      mintedAt: "2024-01-02T00:00:00Z",
      contractTokenId: 456,
      mintQuantity: 1,
      minter: "0x1234",
    };

    it("should fetch recent artifacts with default limit", async () => {
      const mockResponse: ArtifactsListResponse = {
        ok: true,
        items: [mockArtifact],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchRecentArtifacts();

      expect(result).toHaveLength(1);
      expect(result.at(0)).toEqual(mockArtifact);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=50"),
        expect.any(Object)
      );
    });

    it("should fetch with custom limit", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, items: [] }),
      });

      await fetchRecentArtifacts(20);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=20"),
        expect.any(Object)
      );
    });

    it("should return empty array on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await fetchRecentArtifacts();

      expect(result).toEqual([]);
    });

    it("should return empty array when API returns error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: "API error" }),
      });

      const result = await fetchRecentArtifacts();

      expect(result).toEqual([]);
    });
  });

  describe("fetchArtifact", () => {
    const mockArtifact: Artifact = {
      id: "artifact-1",
      botTokenId: 123,
      imageUrl: "https://example.com/image.png",
      title: "Test Artifact",
      createdAt: "2024-01-01T00:00:00Z",
      mintedAt: "2024-01-02T00:00:00Z",
      contractTokenId: 456,
      mintQuantity: 1,
      minter: "0x1234",
    };

    it("should fetch single artifact by contractTokenId", async () => {
      const mockResponse: ArtifactResponse = {
        ok: true,
        artifact: mockArtifact,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchArtifact(456);

      expect(result).toEqual(mockArtifact);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/artifacts/456"),
        expect.any(Object)
      );
    });

    it("should return null on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchArtifact(999);

      expect(result).toBeNull();
    });

    it("should return null when artifact not in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: "NOT_FOUND" }),
      });

      const result = await fetchArtifact(999);

      expect(result).toBeNull();
    });
  });

  describe("fetchBot", () => {
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

    it("should fetch bot by tokenId", async () => {
      const mockResponse: BotResponse = { bot: mockBot };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchBot(123);

      expect(result).toEqual(mockBot);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/bot/123"),
        expect.any(Object)
      );
    });

    it("should return null on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchBot(999);

      expect(result).toBeNull();
    });
  });

  describe("fetchBotStory", () => {
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
            effect: "Deal massive damage",
            cooldown: "30s",
            resource: "Energy",
          },
        ],
        symbolBias: ["⚔️"],
        environmentObjects: ["sword"],
        snippet: "A warrior of renown...",
      },
      storySeed: 12_345,
      storyPowers: ["teleportation"],
      storyStats: { strength: 85 },
      storySnippet: "Personalized snippet",
      missionBrief: "Your mission is...",
    };

    it("should fetch bot story", async () => {
      const mockResponse: BotStoryResponse = { story: mockStory };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchBotStory(123);

      expect(result).toEqual(mockStory);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/bot/123/story"),
        expect.any(Object)
      );
    });

    it("should return null when story is null", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ story: null }),
      });

      const result = await fetchBotStory(123);

      expect(result).toBeNull();
    });

    it("should return null on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await fetchBotStory(123);

      expect(result).toBeNull();
    });
  });

  describe("URL helpers", () => {
    it("should generate bot URL", () => {
      const url = getBotUrl(123);
      expect(url).toContain("/bot/123");
    });

    it("should generate artifact URL", () => {
      const url = getArtifactUrl("artifact-id");
      expect(url).toContain("/artifact/artifact-id");
    });
  });
});
