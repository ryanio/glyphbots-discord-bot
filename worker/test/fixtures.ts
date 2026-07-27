import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import { vi } from "vitest";
import type { Artifact } from "../src/api/types";
import type { MintPollDeps } from "../src/channels/mints";
import type { MintsCursorState } from "../src/durable-objects/feed-state";

export const createArtifact = (
  overrides: Partial<Artifact> = {}
): Artifact => ({
  id: "artifact-1",
  botTokenId: 42,
  imageUrl: "https://example.com/artifact.jpg",
  title: "Test Artifact",
  createdAt: "2025-01-01T00:00:00Z",
  mintedAt: "2025-01-01T00:00:00Z",
  contractTokenId: 1,
  mintQuantity: 1,
  minter: "0x1234567890abcdef1234567890abcdef12345678",
  type: "image",
  ...overrides,
});

/** An artifact that counts as minted. */
export const mintedArtifact = (
  id: string,
  mintedAt: string,
  contractTokenId: number
): Artifact =>
  createArtifact({ id, mintedAt, contractTokenId, title: `Artifact ${id}` });

export const cursor = (
  lastMintedAtMs: number | null,
  postedArtifactIds: string[] = []
): MintsCursorState => ({ lastMintedAtMs, postedArtifactIds });

const roundTrip = (
  state: MintsCursorState | null
): MintsCursorState | null =>
  state === null ? null : (JSON.parse(JSON.stringify(state)) as MintsCursorState);

/**
 * In-memory stand-in for FeedStateDO, same two-method interface.
 *
 * Every read and write goes through JSON, the same trick `sales-fixtures.ts`
 * and `idle-fixtures.ts` use and for the same reason: the production store is
 * a `fetch` to a Durable Object, so anything surviving on object identity
 * alone passes here and fails there. It matters most for this store, because
 * `advanceCursor` copies `postedArtifactIds` out of whatever `read` handed
 * back and a shared array would let a test see writes that never crossed the
 * wire.
 */
export const createMemoryStore = (initial: MintsCursorState | null) => {
  let stored = roundTrip(initial);
  const writes: MintsCursorState[] = [];
  return {
    writes,
    get current() {
      return stored;
    },
    read: () => Promise.resolve(roundTrip(stored)),
    write: (next: MintsCursorState) => {
      stored = roundTrip(next);
      writes.push(stored as MintsCursorState);
      return Promise.resolve();
    },
  };
};

/** Recording poster. Sends resolve unless `failOn` matches the body. */
export const createMemoryPoster = () => {
  const sends: RESTPostAPIChannelMessageJSONBody[] = [];
  const send = vi.fn((body: RESTPostAPIChannelMessageJSONBody) => {
    sends.push(body);
    return Promise.resolve();
  });
  return { sends, send };
};

export const createApi = (artifacts: Artifact[]) => ({
  fetchRecentArtifacts: vi.fn(() => Promise.resolve(artifacts)),
  getArtifactUrl: (id: number) => `https://glyphbots.com/artifact/${id}`,
  getBotUrl: (id: number) => `https://glyphbots.com/bot/${id}`,
});

/** Only the sends that carry an embed (the burst summary carries content). */
export const embedSends = (sends: RESTPostAPIChannelMessageJSONBody[]) =>
  sends.filter((body) => body.embeds !== undefined);

export const contentSends = (sends: RESTPostAPIChannelMessageJSONBody[]) =>
  sends.filter((body) => body.content !== undefined);

/** Deps with the inter-post pause stubbed out. */
export const pollDeps = (
  api: MintPollDeps["api"],
  poster: MintPollDeps["poster"],
  store: MintPollDeps["store"]
): MintPollDeps => ({
  api,
  poster,
  store,
  delay: () => Promise.resolve(),
});
