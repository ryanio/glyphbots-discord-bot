import {
  fetchArtifact,
  fetchArtifactsSummary,
  fetchBot,
  fetchBotStory,
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../../src/api/glyphbots";
import {
  createArtifactsListResponse,
  REAL_ARTIFACT,
  REAL_ARTIFACTS_SUMMARY,
  REAL_BOT,
  REAL_BOT_STORY,
} from "../fixtures";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("glyphbots API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("fetchArtifactsSummary", () => {
    it("should fetch and return summary data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => REAL_ARTIFACTS_SUMMARY,
      });

      const result = await fetchArtifactsSummary();

      expect(result).toEqual(REAL_ARTIFACTS_SUMMARY);
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
    it("should fetch recent artifacts with default limit", async () => {
      const mockResponse = createArtifactsListResponse([REAL_ARTIFACT]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchRecentArtifacts();

      expect(result).toHaveLength(1);
      expect(result.at(0)).toEqual(REAL_ARTIFACT);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=50"),
        expect.any(Object)
      );
    });

    it("should fetch with custom limit", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createArtifactsListResponse([]),
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
    it("should fetch single artifact by contractTokenId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, artifact: REAL_ARTIFACT }),
      });

      const result = await fetchArtifact(137);

      expect(result).toEqual(REAL_ARTIFACT);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/artifacts/137"),
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
    it("should fetch bot by tokenId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bot: REAL_BOT }),
      });

      const result = await fetchBot(2369);

      expect(result).toEqual(REAL_BOT);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/bot/2369"),
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
    it("should fetch bot story", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ story: REAL_BOT_STORY }),
      });

      const result = await fetchBotStory(2369);

      expect(result).toEqual(REAL_BOT_STORY);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/bot/2369/story"),
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
      const url = getArtifactUrl(137);
      expect(url).toContain("/artifact/137");
    });
  });
});
