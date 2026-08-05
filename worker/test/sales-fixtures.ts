import { vi } from "vitest";
import { ARTIFACTS, BOTS } from "../src/api/collections";
import type { EventsSincePage } from "../src/api/opensea";
import type {
  OpenSeaAccount,
  OpenSeaEvent,
  OpenSeaOrder,
} from "../src/api/types";
import type {
  SalesFeedState,
  SalesPollDeps,
  SalesUpdate,
} from "../src/channels/sales";
import { applySalesUpdate } from "../src/channels/sales";
import { emptyGroupingState } from "../src/channels/sales-grouping";
import { createBot, stubGlyphBots } from "./fixtures";

/**
 * One bot sale event. Timestamps are unix seconds, as OpenSea reports them.
 *
 * The `nft` block names its collection, which is what `collectionOf` reads to
 * decide how the event renders. An override that replaces `nft` has to say so
 * too, or the event classifies as a bot by fallback.
 */
export const saleEvent = (
  overrides: Partial<OpenSeaEvent> & { event_timestamp: number }
): OpenSeaEvent => ({
  event_type: "sale",
  chain: "ethereum",
  quantity: 1,
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  transaction: `0xtx${overrides.event_timestamp}`,
  payment: {
    quantity: "1000000000000000000",
    token_address: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    symbol: "ETH",
  },
  nft: {
    identifier: "1",
    name: "GlyphBot",
    collection: BOTS.slug,
    contract: BOTS.contract,
  },
  ...overrides,
});

/**
 * One artifact sale event.
 *
 * `name: ""` is what the live endpoint sends for these tokens, so the default
 * exercises the path where the title has to come from the GlyphBots API rather
 * than from the event.
 */
export const artifactSaleEvent = (
  overrides: Partial<OpenSeaEvent> & { event_timestamp: number }
): OpenSeaEvent =>
  saleEvent({
    nft: {
      identifier: "180",
      name: "",
      collection: ARTIFACTS.slug,
      contract: ARTIFACTS.contract,
    },
    ...overrides,
  });

/** A sweep: one buyer, several tokens, one transaction each. */
export const sweep = (
  count: number,
  timestamp: number,
  buyer = "0x1111111111111111111111111111111111111111"
): OpenSeaEvent[] =>
  Array.from({ length: count }, (_, index) =>
    saleEvent({
      event_timestamp: timestamp + index,
      buyer,
      transaction: `0xsweep${index}`,
      nft: { identifier: String(100 + index), name: "GlyphBot" },
    })
  );

export const salesState = (
  lastEventTimestamp: number,
  overrides: Partial<SalesFeedState> = {}
): SalesFeedState => ({
  lastEventTimestamp,
  grouping: emptyGroupingState(),
  deferred: [],
  ...overrides,
});

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * In-memory stand-in for FeedStateDO's sales record.
 *
 * `apply` runs the shipped `applySalesUpdate`, which is also what the DO runs,
 * so the key merge and the cursor arithmetic under test are the ones that
 * ship. Both directions go through JSON deliberately: DO storage serializes,
 * and a grouping state that survives only because it shares object identity
 * with the caller would pass a test and fail in production.
 */
export const createMemorySalesStore = (initial: SalesFeedState | null) => {
  let stored = initial === null ? null : roundTrip(initial);
  const updates: SalesUpdate[] = [];

  return {
    updates,
    get current(): SalesFeedState | null {
      return stored;
    },
    read: () => Promise.resolve(stored === null ? null : roundTrip(stored)),
    apply: (update: SalesUpdate) => {
      const wire = roundTrip(update);
      updates.push(wire);
      stored = roundTrip(applySalesUpdate(stored, wire));
      return Promise.resolve(stored as SalesFeedState);
    },
  };
};

/**
 * An OpenSea stub. `pages` is served in order, so a test can hand the seed
 * probe one payload and the first real tick another.
 *
 * Each collection has its own list and its own position in it, because a tick
 * sweeps both slugs and a single shared counter would let the artifacts sweep
 * consume the page the next bots tick was meant to see. `pages` is the bots;
 * `extras.artifactPages` is the artifacts and defaults to nothing at all, so
 * every suite that predates the second collection reads as it did.
 *
 * The served page is filtered by the `after` the caller asked for, because the
 * real endpoint returns events strictly after it. A stub that hands back
 * everything regardless makes the cursor untestable: a test asserting the feed
 * does not replay a backlog would be asserting nothing, since the backlog
 * would arrive on every tick whatever the cursor said.
 */
export const createOpenSea = (
  pages: OpenSeaEvent[][],
  extras: {
    /** What the order lookup answers. Null means "OpenSea did not have it". */
    order?: OpenSeaOrder | null;
    /** What the account lookup answers, for the buyer's name. */
    account?: OpenSeaAccount | null;
    /** Pages served for the artifacts slug, in the same shape as `pages`. */
    artifactPages?: OpenSeaEvent[][];
  } = {}
) => {
  const served: Record<string, { pages: OpenSeaEvent[][]; call: number }> = {
    [BOTS.slug]: { pages, call: 0 },
    [ARTIFACTS.slug]: { pages: extras.artifactPages ?? [], call: 0 },
  };

  const fetchCollectionEventsSince = vi.fn(
    (options?: { after?: number; slug?: string }): Promise<EventsSincePage> => {
      const source = served[options?.slug ?? BOTS.slug] ?? {
        pages: [],
        call: 0,
      };
      const page = source.pages[source.call] ?? source.pages.at(-1) ?? [];
      source.call += 1;
      const after = options?.after ?? 0;
      return Promise.resolve({
        events: page.filter((event) => event.event_timestamp > after),
        pages: 1,
        failed: false,
        truncated: false,
      });
    }
  );

  return {
    fetchCollectionEventsSince,
    fetchAccount: vi.fn(() => Promise.resolve(extras.account ?? null)),
    fetchOrder: vi.fn(() => Promise.resolve(extras.order ?? null)),
    /** Sweeps of the bots slug, which is one per tick. */
    get calls() {
      return served[BOTS.slug]?.call ?? 0;
    },
  };
};

/**
 * An OpenSea stub for one sweep with a fixed outcome, so a test can say
 * "truncated" or "failed" without also constructing a pager.
 *
 * The outcome is the bots'. The artifacts sweep answers empty and successful,
 * so a test about a truncated sweep is testing one truncated sweep rather than
 * two, and the events in `page` are not served twice.
 */
export const createSweepStub = (
  page: Partial<EventsSincePage> & { events: OpenSeaEvent[] }
) => ({
  fetchAccount: vi.fn(() => Promise.resolve(null)),
  fetchOrder: vi.fn(() => Promise.resolve(null)),
  fetchCollectionEventsSince: vi.fn(
    (options?: { slug?: string }): Promise<EventsSincePage> =>
      Promise.resolve(
        options?.slug === ARTIFACTS.slug
          ? { events: [], pages: 1, failed: false, truncated: false }
          : { pages: 1, failed: false, truncated: false, ...page }
      )
  ),
});

/**
 * A GlyphBots stub whose batch endpoint answers out of a rank table. Ids that
 * are not in it come back absent, which is what the real endpoint does for a
 * token it has never heard of.
 */
export const stubRanks = (ranks: Record<number, number>) =>
  stubGlyphBots({
    fetchBots: vi.fn((tokenIds: number[]) =>
      Promise.resolve(
        tokenIds
          .filter((tokenId) => tokenId in ranks)
          .map((tokenId) =>
            createBot(tokenId, { rarityRank: ranks[tokenId] as number })
          )
      )
    ),
  });

export const salesPollDeps = (
  opensea: SalesPollDeps["opensea"],
  poster: SalesPollDeps["poster"],
  store: SalesPollDeps["store"],
  now?: () => number,
  /** Defaults to a client that knows no ranks, so no embed carries one. */
  glyphbots: SalesPollDeps["glyphbots"] = stubGlyphBots()
): SalesPollDeps => ({
  opensea,
  glyphbots,
  poster,
  store,
  now,
});
