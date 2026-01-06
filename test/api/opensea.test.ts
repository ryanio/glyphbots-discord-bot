import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchAccount,
  fetchAccountNFTs,
  fetchCollectionEvents,
  fetchCollectionStats,
  fetchListings,
  fetchNFT,
  fetchNFTEvents,
  fetchRandomUserNFT,
  getOpenSeaCollectionUrl,
  getOpenSeaUrl,
  isValidEthereumAddress,
  shortAddress,
} from "../../src/api/opensea";
import type {
  AccountNFTsResponse,
  OpenSeaAccount,
  OpenSeaCollectionStats,
  OpenSeaEventsResponse,
  OpenSeaListingsResponse,
  OpenSeaNFTResponse,
} from "../../src/lib/types";

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const loadFixture = <T>(filename: string): T => {
  const path = join(__dirname, "../fixtures/opensea", filename);
  return JSON.parse(readFileSync(path, "utf-8")) as T;
};

describe("OpenSea API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isValidEthereumAddress", () => {
    it("returns true for valid addresses", () => {
      expect(
        isValidEthereumAddress("0x00A839dE7922491683f547a67795204763ff8237")
      ).toBe(true);
      expect(
        isValidEthereumAddress("0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075")
      ).toBe(true);
    });

    it("returns false for invalid addresses", () => {
      expect(isValidEthereumAddress("not-an-address")).toBe(false);
      expect(isValidEthereumAddress("0x123")).toBe(false);
      expect(isValidEthereumAddress("")).toBe(false);
      expect(
        isValidEthereumAddress("0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG")
      ).toBe(false);
    });
  });

  describe("shortAddress", () => {
    it("shortens an address correctly", () => {
      expect(shortAddress("0x00A839dE7922491683f547a67795204763ff8237")).toBe(
        "0x00A83…f8237"
      );
      expect(shortAddress("0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075")).toBe(
        "0xb6c2c…f5075"
      );
    });
  });

  describe("getOpenSeaUrl", () => {
    it("returns correct OpenSea URL for a token", () => {
      expect(getOpenSeaUrl(1234)).toBe(
        "https://opensea.io/assets/ethereum/0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075/1234"
      );
    });
  });

  describe("getOpenSeaCollectionUrl", () => {
    it("returns correct collection URL", () => {
      expect(getOpenSeaCollectionUrl()).toBe(
        "https://opensea.io/collection/glyphbots"
      );
    });
  });

  describe("fixtures", () => {
    it("parses collection stats fixture correctly", () => {
      const stats = loadFixture<OpenSeaCollectionStats>(
        "get-collection-stats.json"
      );

      expect(stats.total.floor_price).toBe(0.000_297_99);
      expect(stats.total.num_owners).toBe(827);
      expect(stats.total.sales).toBe(7223);
      expect(stats.intervals).toHaveLength(3);
      expect(stats.intervals[0].interval).toBe("one_day");
    });

    it("parses NFT fixture correctly", () => {
      const response = loadFixture<OpenSeaNFTResponse>("get-nft.json");

      expect(response.nft.identifier).toBe("1234");
      expect(response.nft.name).toBe("GlyphBot #1234 - Jumpy the Noble");
      expect(response.nft.collection).toBe("glyphbots");
      expect(response.nft.owners).toHaveLength(1);
      expect(response.nft.rarity?.rank).toBe(3886);
    });

    it("parses account fixture correctly", () => {
      const account = loadFixture<OpenSeaAccount>("get-account.json");

      expect(account.username).toBe("ralx_z");
      expect(account.address).toBe(
        "0x00a839de7922491683f547a67795204763ff8237"
      );
      expect(account.bio).toBe("coding, making, collecting ❤️");
    });

    it("parses account NFTs fixture correctly", () => {
      const response = loadFixture<AccountNFTsResponse>(
        "get-nfts-by-account.json"
      );

      expect(response.nfts).toHaveLength(5);
      expect(response.nfts[0].identifier).toBe("5220");
      expect(response.nfts[0].name).toBe("GlyphBot #5220 - Jumpy the Brave");
      expect(response.next).toBeDefined();
    });
  });

  describe("fetchAccount", () => {
    it("should fetch account data", async () => {
      const accountData = loadFixture<OpenSeaAccount>("get-account.json");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => accountData,
      } as Response);

      const result = await fetchAccount(
        "0x00a839de7922491683f547a67795204763ff8237"
      );

      expect(result).toEqual(accountData);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return undefined on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const result = await fetchAccount("0xnonexistent");

      expect(result).toBeUndefined();
    });
  });

  describe("fetchNFT", () => {
    it("should fetch NFT data", async () => {
      const nftData = loadFixture<OpenSeaNFTResponse>("get-nft.json");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => nftData,
      } as Response);

      const result = await fetchNFT(1234);

      expect(result).toEqual(nftData.nft);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return undefined on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
      } as Response);

      const result = await fetchNFT(9999);

      expect(result).toBeUndefined();
    });
  });

  describe("fetchCollectionStats", () => {
    it("should fetch collection stats", async () => {
      const statsData = loadFixture<OpenSeaCollectionStats>(
        "get-collection-stats.json"
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => statsData,
      } as Response);

      const result = await fetchCollectionStats();

      expect(result).toEqual(statsData);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return undefined on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
      } as Response);

      const result = await fetchCollectionStats();

      expect(result).toBeUndefined();
    });
  });

  describe("fetchAccountNFTs", () => {
    it("should fetch account NFTs", async () => {
      const nftsData = loadFixture<AccountNFTsResponse>(
        "get-nfts-by-account.json"
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => nftsData,
      } as Response);

      const result = await fetchAccountNFTs(
        "0x00a839de7922491683f547a67795204763ff8237"
      );

      expect(result).toHaveLength(5);
      expect(result[0].identifier).toBe("5220");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return empty array on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
      } as Response);

      const result = await fetchAccountNFTs("0xnonexistent");

      expect(result).toEqual([]);
    });

    it("should return empty array when no NFTs found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nfts: [] }),
      } as Response);

      const result = await fetchAccountNFTs("0xemptywallet");

      expect(result).toEqual([]);
    });
  });

  describe("fetchRandomUserNFT", () => {
    it("should return a random NFT from user collection", async () => {
      const nftsData = loadFixture<AccountNFTsResponse>(
        "get-nfts-by-account.json"
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => nftsData,
      } as Response);

      const result = await fetchRandomUserNFT(
        "0x00a839de7922491683f547a67795204763ff8237"
      );

      expect(result).toBeDefined();
      expect(nftsData.nfts).toContainEqual(result);
    });

    it("should return undefined when no NFTs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nfts: [] }),
      } as Response);

      const result = await fetchRandomUserNFT("0xemptywallet");

      expect(result).toBeUndefined();
    });
  });

  describe("fetchCollectionEvents", () => {
    it("should fetch sale events", async () => {
      const eventsData = loadFixture<OpenSeaEventsResponse>(
        "get-events-sales.json"
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => eventsData,
      } as Response);

      const result = await fetchCollectionEvents("sale", 10);

      expect(result).toHaveLength(2);
      expect(result[0].event_type).toBe("sale");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return empty array on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
      } as Response);

      const result = await fetchCollectionEvents("sale");

      expect(result).toEqual([]);
    });
  });

  describe("fetchListings", () => {
    it("should fetch listings", async () => {
      const listingsData =
        loadFixture<OpenSeaListingsResponse>("get-listings.json");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => listingsData,
      } as Response);

      const result = await fetchListings(10);

      expect(result).toHaveLength(2);
      expect(result[0].price.current.currency).toBe("ETH");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return empty array on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
      } as Response);

      const result = await fetchListings();

      expect(result).toEqual([]);
    });
  });

  describe("fetchNFTEvents", () => {
    it("should fetch events for specific NFT", async () => {
      const eventsData = loadFixture<OpenSeaEventsResponse>(
        "get-events-sales.json"
      );
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => eventsData,
      } as Response);

      const result = await fetchNFTEvents(1234, 10);

      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return empty array on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const result = await fetchNFTEvents(9999);

      expect(result).toEqual([]);
    });
  });
});
