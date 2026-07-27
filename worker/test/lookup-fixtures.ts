/**
 * Stand-ins for the two API clients on the inline lookup path.
 *
 * Same idea as `fixtures.ts`: the production code takes interfaces, so the
 * tests hand it plain objects and count the calls. Every fake here records
 * what it was asked for, because the point of most of these tests is how much
 * network the path spends, not only what it says.
 */

import { vi } from "vitest";
import type { GlyphBotsClient } from "../src/api/glyphbots";
import type { OpenSeaClient } from "../src/api/opensea";
import type {
  AccountNFT,
  Artifact,
  ArtifactSummary,
  Bot,
  OpenSeaAccount,
  OpenSeaCollectionStats,
  OpenSeaNFT,
} from "../src/api/types";
import type { LookupClients } from "../src/lookups/embeds";

export const createBot = (tokenId: number, overrides: Partial<Bot> = {}): Bot => ({
  id: `bot-${tokenId}`,
  name: `GlyphBot #${tokenId} - Vector`,
  tokenId,
  traits: [
    { trait_type: "Core", value: "Plasma" },
    { trait_type: "Frame", value: "None" },
  ],
  rarityRank: 500,
  burnedAt: null,
  burnedBy: null,
  ...overrides,
});

export const createLookupArtifact = (
  contractTokenId: number,
  overrides: Partial<Artifact> = {}
): Artifact => ({
  id: `artifact-${contractTokenId}`,
  botTokenId: 7,
  imageUrl: "https://www.glyphbots.com/artifacts/1.jpg",
  title: `Artifact ${contractTokenId}`,
  createdAt: "2025-01-01T00:00:00Z",
  mintedAt: "2025-01-01T00:00:00Z",
  contractTokenId,
  mintQuantity: 1,
  minter: "0x1234567890abcdef1234567890abcdef12345678",
  type: "image",
  ...overrides,
});

export const createOpenSeaNFT = (tokenId: number): OpenSeaNFT => ({
  identifier: String(tokenId),
  collection: "glyphbots",
  contract: "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075",
  token_standard: "erc721",
  opensea_url: `https://opensea.io/assets/ethereum/x/${tokenId}`,
  owners: [{ address: "0xabcdef1234567890abcdef1234567890abcdef12", quantity: 1 }],
  rarity: { strategy_id: "openrarity", strategy_version: "1", rank: 42 },
});

export type FakeClientOptions = {
  account?: OpenSeaAccount | null;
  accountNFTs?: AccountNFT[];
  artifacts?: Record<number, Artifact | null>;
  artifactSummary?: ArtifactSummary | null;
  bots?: Record<number, Bot | null>;
  collectionStats?: OpenSeaCollectionStats | null;
  recentArtifacts?: Artifact[];
  /** Per-token OpenSea answers. Anything unlisted falls back to the default. */
  nfts?: Record<number, OpenSeaNFT | null>;
};

/** A `LookupClients` whose every method is a spy. */
export const createLookupClients = (options: FakeClientOptions = {}) => {
  const fetchBot = vi.fn((tokenId: number) =>
    Promise.resolve(
      options.bots ? (options.bots[tokenId] ?? null) : createBot(tokenId)
    )
  );
  const fetchArtifact = vi.fn((tokenId: number) =>
    Promise.resolve(
      options.artifacts
        ? (options.artifacts[tokenId] ?? null)
        : createLookupArtifact(tokenId)
    )
  );
  const fetchRecentArtifacts = vi.fn(() =>
    Promise.resolve(options.recentArtifacts ?? [])
  );
  const fetchNFT = vi.fn((tokenId: number) =>
    Promise.resolve(
      options.nfts ? (options.nfts[tokenId] ?? null) : createOpenSeaNFT(tokenId)
    )
  );
  const fetchArtifactSummary = vi.fn(() =>
    Promise.resolve(options.artifactSummary ?? null)
  );
  const fetchCollectionStats = vi.fn(() =>
    Promise.resolve(options.collectionStats ?? null)
  );
  const fetchAccount = vi.fn(() =>
    Promise.resolve(
      options.account === undefined
        ? { address: "0xowner", username: "someone" }
        : options.account
    )
  );
  const fetchAccountNFTs = vi.fn(() =>
    Promise.resolve(options.accountNFTs ?? [])
  );

  const glyphbots = {
    baseUrl: "https://www.glyphbots.com",
    fetchArtifact,
    fetchArtifactSummary,
    fetchBot,
    fetchBotStory: vi.fn(() => Promise.resolve(null)),
    fetchRecentArtifacts,
    getArtifactUrl: (id: number) => `https://www.glyphbots.com/artifact/${id}`,
    getBotPngUrl: (id: number) => `https://www.glyphbots.com/bots/pngs/${id}.png`,
    getBotUrl: (id: number) => `https://www.glyphbots.com/bot/${id}`,
  } satisfies GlyphBotsClient;

  const opensea = {
    fetchAccount,
    fetchAccountNFTs,
    fetchCollectionEvents: vi.fn(() => Promise.resolve([])),
    fetchCollectionEventsSince: vi.fn(() =>
      Promise.resolve({ events: [], pages: 1, failed: false })
    ),
    fetchCollectionStats,
    fetchListings: vi.fn(() => Promise.resolve([])),
    fetchNFT,
    fetchNFTEvents: vi.fn(() => Promise.resolve([])),
  } satisfies OpenSeaClient;

  const clients: LookupClients = { glyphbots, opensea };

  return {
    clients,
    fetchAccount,
    fetchAccountNFTs,
    fetchArtifact,
    fetchArtifactSummary,
    fetchBot,
    fetchCollectionStats,
    fetchNFT,
    fetchRecentArtifacts,
    /** Every outbound call this path would have made. */
    get subrequests() {
      return (
        fetchBot.mock.calls.length +
        fetchArtifact.mock.calls.length +
        fetchRecentArtifacts.mock.calls.length +
        fetchNFT.mock.calls.length +
        fetchAccount.mock.calls.length +
        fetchAccountNFTs.mock.calls.length +
        fetchArtifactSummary.mock.calls.length +
        fetchCollectionStats.mock.calls.length
      );
    },
  };
};
