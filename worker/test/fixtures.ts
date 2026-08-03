/**
 * The fixtures every suite shares, plus the mint watcher's own.
 *
 * Two patterns run through `test/`, and everything in this directory follows
 * one of them:
 *
 * - **Stores** round-trip through JSON on every read and write, and run the
 *   shipped merge rather than a re-implementation of it. The production store
 *   is a `fetch` to a Durable Object, so anything that survives on object
 *   identity alone passes here and fails there. `idle-fixtures.ts` is the
 *   reference.
 * - **Clients** carry the interface they stand for, either as a return type or
 *   with `satisfies`, so a method added to the real client fails `tsc` in the
 *   fixture rather than going quietly missing. `lookup-fixtures.ts` is the
 *   reference.
 */

import type {
  APIEmbed,
  RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { vi } from "vitest";
import type { GlyphBotsClient } from "../src/api/glyphbots";
import type { Artifact, Bot } from "../src/api/types";
import type {
  MintCursorUpdate,
  MintedArtifact,
  MintPollDeps,
  MintsCursorState,
} from "../src/channels/mints";
import { applyMintCursorUpdate } from "../src/channels/mints";
import { FeedStateDO } from "../src/durable-objects/feed-state";

/** The production origin, which several fixtures build URLs against. */
export const TEST_ORIGIN = "https://www.glyphbots.com";

/**
 * Index into a fixture array, failing loudly rather than widening.
 *
 * `noUncheckedIndexedAccess` is on, so `items[0]` is `T | undefined` and the
 * shortest way past that is a cast. A cast is exactly the wrong tool: it turns
 * "this fixture is not shaped the way the test thinks" from a failure into a
 * confusing one somewhere else.
 */
export const at = <T>(items: readonly T[], index = 0): T => {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`fixture has no element at index ${index}`);
  }
  return item;
};

/**
 * One artifact. Everything not overridden is derived from the token id, so a
 * test that cares about the title can say `{ contractTokenId: 5 }` and assert
 * `"Artifact 5"`.
 */
export const createArtifact = (overrides: Partial<Artifact> = {}): Artifact => {
  const contractTokenId = overrides.contractTokenId ?? 12;
  return {
    id: `artifact-${contractTokenId}`,
    botTokenId: 7,
    imageUrl: `${TEST_ORIGIN}/artifacts/${contractTokenId}.jpg`,
    title: `Artifact ${contractTokenId}`,
    createdAt: "2025-01-01T00:00:00Z",
    mintedAt: "2025-01-02T00:00:00Z",
    contractTokenId,
    mintQuantity: 1,
    minter: "0x1234567890abcdef1234567890abcdef12345678",
    // Present by default, because the API summary carries it for anything that
    // reached the chain. A test for the missing case passes `undefined`.
    mintTxHash: `0xmint${contractTokenId}`,
    type: "image",
    ...overrides,
  };
};

/**
 * An artifact that is on chain, typed as one.
 *
 * `MintedArtifact` narrows `mintedAt` and `contractTokenId` to non-null, and
 * the whole point of `isMinted` is that `Artifact` does not. Building the
 * narrow type here is what lets the cursor tests call `advanceCursor` without
 * a cast.
 */
export const mintedArtifact = (
  id: string,
  mintedAt: string,
  contractTokenId: number
): MintedArtifact => ({
  ...createArtifact({ id, contractTokenId, title: `Artifact ${id}` }),
  mintedAt,
  contractTokenId,
});

/** One bot. `tokenId` drives the id and the name, as the real API does. */
export const createBot = (tokenId = 7, overrides: Partial<Bot> = {}): Bot => ({
  id: `bot-${tokenId}`,
  name: `GlyphBot #${tokenId} - Wanderer`,
  tokenId,
  traits: [
    { trait_type: "Head", value: "Antenna" },
    { trait_type: "Aura", value: "None" },
  ],
  rarityRank: 500,
  burnedAt: null,
  burnedBy: null,
  ...overrides,
});

/** A GlyphBots client with every method stubbed and the real URL helpers. */
export const stubGlyphBots = (
  overrides: Partial<GlyphBotsClient> = {}
): GlyphBotsClient => ({
  baseUrl: TEST_ORIGIN,
  fetchArtifact: vi.fn(() => Promise.resolve(null)),
  fetchArtifactSummary: vi.fn(() => Promise.resolve(null)),
  fetchBot: vi.fn(() => Promise.resolve(null)),
  // Empty by default, so a suite that does not care about rarity renders the
  // same replies it did before ranks were on them.
  fetchBots: vi.fn(() => Promise.resolve([] as Bot[])),
  fetchBotStory: vi.fn(() => Promise.resolve(null)),
  fetchRecentArtifacts: vi.fn(() => Promise.resolve([])),
  getArtifactUrl: (id: number) => `${TEST_ORIGIN}/artifact/${id}`,
  getBotPngUrl: (id: number) => `${TEST_ORIGIN}/bots/pngs/${id}.png`,
  getBotUrl: (id: number) => `${TEST_ORIGIN}/bot/${id}`,
  ...overrides,
});

export const cursor = (
  lastMintedAtMs: number | null,
  postedArtifactIds: string[] = []
): MintsCursorState => ({ lastMintedAtMs, postedArtifactIds });

const roundTrip = (state: MintsCursorState | null): MintsCursorState | null =>
  state === null
    ? null
    : (JSON.parse(JSON.stringify(state)) as MintsCursorState);

/**
 * In-memory stand-in for the mint cursor record.
 *
 * `apply` runs the shipped `applyMintCursorUpdate`, which is also what the DO
 * runs, so what these tests exercise is the merge that ships rather than a
 * second copy of it.
 *
 * Both directions go through JSON. The production store is a `fetch` to a
 * Durable Object, so anything surviving on object identity alone would pass
 * here and fail there, and it matters most for this record: `advanceCursor`
 * copies `postedArtifactIds` out of whatever it was handed, and a shared array
 * would let a test see a write that never crossed the wire.
 */
export const createMemoryStore = (initial: MintsCursorState | null) => {
  let stored = roundTrip(initial);
  const updates: MintCursorUpdate[] = [];

  return {
    updates,
    get current() {
      return stored;
    },
    read: () => Promise.resolve(roundTrip(stored)),
    apply: (update: MintCursorUpdate) => {
      const wire = JSON.parse(JSON.stringify(update)) as MintCursorUpdate;
      updates.push(wire);
      stored = roundTrip(applyMintCursorUpdate(stored, wire));
      return Promise.resolve(stored as MintsCursorState);
    },
  };
};

export type MemoryPosterOptions = {
  /**
   * Reject rather than record. An `Error` fails every send; a function is
   * handed each body and returns an `Error` to fail that one or `null` to let
   * it through, which is how a test fails only the burst summary.
   *
   * A rejected send is not added to `sends`, so that array is what actually
   * reached the channel.
   */
  failWith?:
    | Error
    | ((body: RESTPostAPIChannelMessageJSONBody) => Error | null);
};

/** Recording poster, shared by every channel suite. */
export const createMemoryPoster = (options: MemoryPosterOptions = {}) => {
  const sends: RESTPostAPIChannelMessageJSONBody[] = [];
  const send = vi.fn((body: RESTPostAPIChannelMessageJSONBody) => {
    const failure =
      typeof options.failWith === "function"
        ? options.failWith(body)
        : (options.failWith ?? null);

    if (failure) {
      return Promise.reject(failure);
    }

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

/**
 * The first embed on a message body or an interaction follow-up, as an
 * `APIEmbed`.
 *
 * Throwing on an absent embed rather than returning `undefined` keeps the
 * failure at the line that expected one, and `APIEmbed` is the type the
 * builders actually produce, so a test cannot assert against a field Discord
 * has no such thing as.
 */
export const firstEmbed = (
  body: { embeds?: APIEmbed[] | null } | undefined
): APIEmbed => {
  const embed = body?.embeds?.[0];
  if (!embed) {
    throw new Error("expected an embed on this message");
  }
  return embed;
};

/** Mint poll deps with the inter-post pause stubbed out. */
export const mintPollDeps = (
  api: MintPollDeps["api"],
  poster: MintPollDeps["poster"],
  store: MintPollDeps["store"]
): MintPollDeps => ({
  api,
  poster,
  store,
  delay: () => Promise.resolve(),
});

/**
 * A real `FeedStateDO` over an in-memory `DurableObjectState`.
 *
 * `put` goes through JSON, which is what DO storage does to a structured value
 * it has to persist, so a record that survives only by object identity fails
 * here exactly as it would in production. `initial` seeds storage directly,
 * bypassing the validator, which is how a corrupt stored record is tested.
 */
export const createFeedStateDO = (initial: Record<string, unknown> = {}) => {
  const storage = new Map<string, unknown>(Object.entries(initial));
  const feed = new FeedStateDO({
    storage: {
      get: <T>(key: string) =>
        Promise.resolve(storage.get(key) as T | undefined),
      put: (key: string, value: unknown) => {
        storage.set(key, JSON.parse(JSON.stringify(value)) as unknown);
        return Promise.resolve();
      },
    },
  } as unknown as DurableObjectState);

  const url = (path: string) => `https://feed-state/${path}`;

  return {
    storage,
    /** The record at `path`, or `null` when it is absent or does not parse. */
    read: async <State>(path: string): Promise<State | null> => {
      const response = await feed.fetch(new Request(url(path)));
      return ((await response.json()) as { state: State | null }).state;
    },
    /** Send one operation. The raw `Response`, so a test can assert a 400. */
    apply: (path: string, update: unknown): Promise<Response> =>
      feed.fetch(
        new Request(url(path), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        })
      ),
    /** Any other method, for the 404 and 405 cases. */
    request: (path: string, method: string): Promise<Response> =>
      feed.fetch(new Request(url(path), { method })),
  };
};
