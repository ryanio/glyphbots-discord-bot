import type { Client } from "discord.js";
import { mockDeep, mockReset } from "jest-mock-extended";
import {
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../../src/api/glyphbots";
import { initMintsChannel } from "../../src/channels/mints";
import {
  type MintsCursorState,
  recordChannelPost,
  recordMintsCursor,
  resolveMintsCursor,
} from "../../src/lib/state";
import {
  createArtifact,
  createConfig,
  createMockChannel,
  type MockChannel,
} from "../fixtures";

jest.mock("../../src/api/glyphbots");
jest.mock("../../src/lib/state");

// Keep the real utils but drop the inter-post rate-limit pause so the
// sequential posting loop resolves immediately under test.
jest.mock("../../src/lib/utils", () => ({
  ...jest.requireActual("../../src/lib/utils"),
  delay: jest.fn(() => Promise.resolve()),
}));

const mockFetchRecentArtifacts = fetchRecentArtifacts as jest.MockedFunction<
  typeof fetchRecentArtifacts
>;
const mockGetBotUrl = getBotUrl as jest.MockedFunction<typeof getBotUrl>;
const mockGetArtifactUrl = getArtifactUrl as jest.MockedFunction<
  typeof getArtifactUrl
>;
const mockResolveMintsCursor = resolveMintsCursor as jest.MockedFunction<
  typeof resolveMintsCursor
>;
const mockRecordMintsCursor = recordMintsCursor as jest.MockedFunction<
  typeof recordMintsCursor
>;
const mockRecordChannelPost = recordChannelPost as jest.MockedFunction<
  typeof recordChannelPost
>;

const MINTS_CONFIG = createConfig({ mintsChannelId: "999888777" });

/** Build an artifact that counts as minted */
const mintedArtifact = (
  id: string,
  mintedAt: string,
  contractTokenId: number
) =>
  createArtifact({
    id,
    mintedAt,
    contractTokenId,
    title: `Artifact ${id}`,
  });

/** Cursor helper matching the seeded shape */
const cursor = (
  lastMintedAtMs: number | null,
  postedArtifactIds: string[] = []
): MintsCursorState => ({ lastMintedAtMs, postedArtifactIds });

/** Extract only the embed sends (burst summary sends have content, not embeds) */
const embedSends = (channel: MockChannel) =>
  channel.send.mock.calls.filter(
    (call) => (call[0] as { embeds?: unknown[] }).embeds !== undefined
  );

describe("mints channel", () => {
  let mockChannel: MockChannel;
  const mockClient = mockDeep<Client>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockReset(mockClient);
    jest.useFakeTimers();

    mockChannel = createMockChannel({ name: "mints" });
    mockClient.channels.fetch.mockResolvedValue(mockChannel as never);

    mockGetBotUrl.mockReturnValue("https://glyphbots.com/bot/123");
    mockGetArtifactUrl.mockReturnValue("https://glyphbots.com/artifact/456");
    mockRecordMintsCursor.mockResolvedValue(undefined);
    mockRecordChannelPost.mockResolvedValue(undefined);
    mockFetchRecentArtifacts.mockResolvedValue([]);
    mockResolveMintsCursor.mockResolvedValue(cursor(0));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("configuration", () => {
    it("returns null when no mints channel is configured", async () => {
      await expect(
        initMintsChannel(mockClient, createConfig({ mintsChannelId: null }))
      ).resolves.toBeNull();

      expect(mockClient.channels.fetch).not.toHaveBeenCalled();
    });

    it("does not throw when the channel does not exist", async () => {
      mockClient.channels.fetch.mockResolvedValue(null as never);

      await expect(
        initMintsChannel(mockClient, MINTS_CONFIG)
      ).resolves.toBeNull();
    });

    it("does not throw when the channel fetch rejects", async () => {
      mockClient.channels.fetch.mockRejectedValue(new Error("Unknown Channel"));

      await expect(
        initMintsChannel(mockClient, MINTS_CONFIG)
      ).resolves.toBeNull();
    });

    it("does not throw when the channel is not text-based", async () => {
      mockClient.channels.fetch.mockResolvedValue(
        createMockChannel({ isTextBased: () => false }) as never
      );

      await expect(
        initMintsChannel(mockClient, MINTS_CONFIG)
      ).resolves.toBeNull();
    });

    it("returns a status object when initialized", async () => {
      const status = await initMintsChannel(mockClient, MINTS_CONFIG);

      expect(status).toEqual(
        expect.objectContaining({
          channelName: "mints",
          status: expect.any(String),
        })
      );
    });
  });

  describe("cold start", () => {
    it("seeds the cursor and posts nothing", async () => {
      mockResolveMintsCursor.mockResolvedValue(null);
      mockFetchRecentArtifacts.mockResolvedValue([
        mintedArtifact("a", "2025-01-01T00:00:00Z", 1),
        mintedArtifact("b", "2025-01-02T00:00:00Z", 2),
        mintedArtifact("c", "2025-01-03T00:00:00Z", 3),
      ]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      expect(mockChannel.send).not.toHaveBeenCalled();
      expect(mockRecordMintsCursor).toHaveBeenCalledWith({
        lastMintedAtMs: new Date("2025-01-03T00:00:00Z").getTime(),
        postedArtifactIds: ["a", "b", "c"],
      });
    });
  });

  describe("new mint detection", () => {
    it("posts a newly detected mint exactly once", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([
        mintedArtifact("new-1", "2025-06-01T00:00:00Z", 10),
      ]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      expect(embedSends(mockChannel)).toHaveLength(1);
      expect(mockRecordChannelPost).toHaveBeenCalledWith(
        "mints",
        expect.objectContaining({ artifactId: "new-1" })
      );
    });

    it("posts oldest first so the channel reads chronologically", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([
        mintedArtifact("newest", "2025-06-03T00:00:00Z", 12),
        mintedArtifact("oldest", "2025-06-01T00:00:00Z", 10),
        mintedArtifact("middle", "2025-06-02T00:00:00Z", 11),
      ]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      const postedIds = mockRecordChannelPost.mock.calls.map(
        (call) => (call[1] as { artifactId: string }).artifactId
      );
      expect(postedIds).toEqual(["oldest", "middle", "newest"]);
    });

    it("does not repost the same artifact on a second poll", async () => {
      const artifact = mintedArtifact("dupe", "2025-06-01T00:00:00Z", 10);
      mockFetchRecentArtifacts.mockResolvedValue([artifact]);

      // First poll: nothing posted yet.
      let stored: MintsCursorState = cursor(0);
      mockResolveMintsCursor.mockImplementation(() => Promise.resolve(stored));
      mockRecordMintsCursor.mockImplementation((next) => {
        stored = next;
        return Promise.resolve();
      });

      await initMintsChannel(mockClient, MINTS_CONFIG);
      expect(embedSends(mockChannel)).toHaveLength(1);

      // Second poll with the identical API payload.
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(embedSends(mockChannel)).toHaveLength(1);
      expect(stored.postedArtifactIds).toContain("dupe");
    });

    it("posts nothing when the API returns no artifacts", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      expect(mockChannel.send).not.toHaveBeenCalled();
    });
  });

  describe("unminted artifacts", () => {
    it("ignores artifacts with a null mintedAt", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([
        createArtifact({ id: "unminted", mintedAt: null, contractTokenId: 5 }),
      ]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it("ignores artifacts with a null contractTokenId", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([
        createArtifact({
          id: "no-token",
          mintedAt: "2025-06-01T00:00:00Z",
          contractTokenId: null,
        }),
      ]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it("ignores unminted artifacts when seeding the cursor", async () => {
      mockResolveMintsCursor.mockResolvedValue(null);
      mockFetchRecentArtifacts.mockResolvedValue([
        mintedArtifact("real", "2025-01-01T00:00:00Z", 1),
        createArtifact({
          id: "pending",
          mintedAt: null,
          contractTokenId: null,
        }),
      ]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      expect(mockRecordMintsCursor).toHaveBeenCalledWith({
        lastMintedAtMs: new Date("2025-01-01T00:00:00Z").getTime(),
        postedArtifactIds: ["real"],
      });
    });
  });

  describe("burst guard", () => {
    it("caps individual posts and summarizes the rest", async () => {
      const batch = Array.from({ length: 9 }, (_, i) =>
        mintedArtifact(
          `burst-${i}`,
          new Date(Date.UTC(2025, 5, i + 1)).toISOString(),
          100 + i
        )
      );
      mockFetchRecentArtifacts.mockResolvedValue(batch);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      // 5 individual embeds, plus exactly one text summary line.
      expect(embedSends(mockChannel)).toHaveLength(5);

      const summarySends = mockChannel.send.mock.calls.filter(
        (call) => (call[0] as { content?: string }).content !== undefined
      );
      expect(summarySends).toHaveLength(1);
      expect((summarySends[0][0] as { content: string }).content).toContain(
        "4"
      );
    });

    it("advances the cursor past every mint in the burst", async () => {
      const batch = Array.from({ length: 9 }, (_, i) =>
        mintedArtifact(
          `burst-${i}`,
          new Date(Date.UTC(2025, 5, i + 1)).toISOString(),
          100 + i
        )
      );
      mockFetchRecentArtifacts.mockResolvedValue(batch);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      const lastCall = mockRecordMintsCursor.mock.calls.at(-1);
      const saved = lastCall?.[0] as MintsCursorState;

      expect(saved.lastMintedAtMs).toBe(Date.UTC(2025, 5, 9));
      for (let i = 0; i < 9; i++) {
        expect(saved.postedArtifactIds).toContain(`burst-${i}`);
      }
    });
  });

  describe("embed content", () => {
    it("includes the artifact image and links", async () => {
      const artifact = mintedArtifact("embed", "2025-06-01T00:00:00Z", 77);
      mockFetchRecentArtifacts.mockResolvedValue([artifact]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                image: expect.objectContaining({ url: artifact.imageUrl }),
              }),
            }),
          ]),
        })
      );
      expect(mockGetArtifactUrl).toHaveBeenCalledWith(77);
      expect(mockGetBotUrl).toHaveBeenCalledWith(artifact.botTokenId);
    });

    it("links the mint transaction on Etherscan when present", async () => {
      mockFetchRecentArtifacts.mockResolvedValue([
        createArtifact({
          id: "tx",
          mintedAt: "2025-06-01T00:00:00Z",
          contractTokenId: 88,
          mintTxHash: "0xdeadbeef",
        }),
      ]);

      await initMintsChannel(mockClient, MINTS_CONFIG);

      const sent = mockChannel.send.mock.calls[0][0] as {
        embeds: Array<{ data: { fields: Array<{ value: string }> } }>;
      };
      const values = sent.embeds[0].data.fields.map((f) => f.value).join(" ");
      expect(values).toContain("https://etherscan.io/tx/0xdeadbeef");
    });
  });

  describe("retry on send failure", () => {
    it("holds the cursor back so a failed mint is retried next poll", async () => {
      mockResolveMintsCursor.mockResolvedValue(cursor(1000));
      mockFetchRecentArtifacts.mockResolvedValue([
        mintedArtifact("boom", "2025-06-01T00:00:00Z", 1),
      ]);
      mockChannel.send.mockRejectedValue(new Error("discord 500"));

      await initMintsChannel(mockClient, MINTS_CONFIG);

      const saved = mockRecordMintsCursor.mock.calls.at(-1)?.[0];
      // The failed mint must not be recorded as posted, and the timestamp must
      // not move past it, otherwise it is dropped forever.
      expect(saved?.postedArtifactIds).not.toContain("boom");
      expect(saved?.lastMintedAtMs).toBeLessThanOrEqual(
        new Date("2025-06-01T00:00:00Z").getTime()
      );
    });

    it("keeps a successful mint recorded even when a sibling fails", async () => {
      mockResolveMintsCursor.mockResolvedValue(cursor(1000));
      mockFetchRecentArtifacts.mockResolvedValue([
        mintedArtifact("ok", "2025-06-01T00:00:00Z", 1),
        mintedArtifact("bad", "2025-06-02T00:00:00Z", 2),
      ]);
      mockChannel.send
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("discord 500"));

      await initMintsChannel(mockClient, MINTS_CONFIG);

      const saved = mockRecordMintsCursor.mock.calls.at(-1)?.[0];
      expect(saved?.postedArtifactIds).toContain("ok");
      expect(saved?.postedArtifactIds).not.toContain("bad");
    });
  });

  describe("error handling", () => {
    it("does not throw when sending fails", async () => {
      mockChannel.send.mockRejectedValue(new Error("Discord API error"));
      mockFetchRecentArtifacts.mockResolvedValue([
        mintedArtifact("fails", "2025-06-01T00:00:00Z", 10),
      ]);

      await expect(
        initMintsChannel(mockClient, MINTS_CONFIG)
      ).resolves.not.toBeNull();
    });

    it("does not throw when the API call rejects", async () => {
      mockFetchRecentArtifacts.mockRejectedValue(new Error("network down"));

      await expect(
        initMintsChannel(mockClient, MINTS_CONFIG)
      ).resolves.not.toBeNull();
    });
  });
});
