import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import { vi } from "vitest";
import type { EventsSincePage } from "../src/api/opensea";
import type { OpenSeaEvent } from "../src/api/types";
import type { SalesFeedState, SalesPollDeps } from "../src/channels/sales";
import { emptyGroupingState } from "../src/channels/sales-grouping";

export const TEST_ORIGIN = "https://www.glyphbots.com";

/** One sale event. Timestamps are unix seconds, as OpenSea reports them. */
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
  nft: { identifier: "1", name: "GlyphBot" },
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

/**
 * In-memory stand-in for FeedStateDO's sales record.
 *
 * `write` round-trips through JSON deliberately: DO storage serializes, and a
 * grouping state that only survives because it shares object identity with the
 * caller would pass a test and fail in production.
 */
export const createMemorySalesStore = (initial: SalesFeedState | null) => {
  let stored = initial === null ? null : JSON.parse(JSON.stringify(initial));
  const writes: SalesFeedState[] = [];
  return {
    writes,
    get current(): SalesFeedState | null {
      return stored;
    },
    read: () =>
      Promise.resolve(
        stored === null ? null : (JSON.parse(JSON.stringify(stored)) as SalesFeedState)
      ),
    write: (next: SalesFeedState) => {
      stored = JSON.parse(JSON.stringify(next));
      writes.push(stored as SalesFeedState);
      return Promise.resolve();
    },
  };
};

export const createMemoryPoster = () => {
  const sends: RESTPostAPIChannelMessageJSONBody[] = [];
  const send = vi.fn((body: RESTPostAPIChannelMessageJSONBody) => {
    sends.push(body);
    return Promise.resolve();
  });
  return { sends, send };
};

/**
 * An OpenSea stub. `pages` is served in order, so a test can hand the seed
 * probe one payload and the first real tick another.
 *
 * The served page is filtered by the `after` the caller asked for, because the
 * real endpoint returns events strictly after it. A stub that hands back
 * everything regardless makes the cursor untestable: a test asserting the feed
 * does not replay a backlog would be asserting nothing, since the backlog
 * would arrive on every tick whatever the cursor said.
 */
export const createOpenSea = (pages: OpenSeaEvent[][]) => {
  let call = 0;
  const fetchCollectionEventsSince = vi.fn(
    (options?: { after?: number }): Promise<EventsSincePage> => {
      const served = pages[call] ?? pages.at(-1) ?? [];
      call += 1;
      const after = options?.after ?? 0;
      return Promise.resolve({
        events: served.filter((event) => event.event_timestamp > after),
        pages: 1,
        failed: false,
        truncated: false,
      });
    }
  );
  return {
    fetchCollectionEventsSince,
    fetchAccount: vi.fn(() => Promise.resolve(null)),
    get calls() {
      return call;
    },
  };
};

/**
 * An OpenSea stub for one sweep with a fixed outcome, so a test can say
 * "truncated" or "failed" without also constructing a pager.
 */
export const createSweepStub = (
  page: Partial<EventsSincePage> & { events: OpenSeaEvent[] }
) => ({
  fetchAccount: vi.fn(() => Promise.resolve(null)),
  fetchCollectionEventsSince: vi.fn(
    (): Promise<EventsSincePage> =>
      Promise.resolve({
        pages: 1,
        failed: false,
        truncated: false,
        ...page,
      })
  ),
});

export const stubGlyphBots = () => ({
  getBotPngUrl: (id: number) => `${TEST_ORIGIN}/bots/pngs/${id}.png`,
  getBotUrl: (id: number) => `${TEST_ORIGIN}/bot/${id}`,
});

export const pollDeps = (
  opensea: SalesPollDeps["opensea"],
  poster: SalesPollDeps["poster"],
  store: SalesPollDeps["store"],
  now?: () => number
): SalesPollDeps => ({
  opensea,
  glyphbots: stubGlyphBots(),
  poster,
  store,
  now,
});

type EmbedJson = {
  title?: string;
  url?: string;
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: Array<{ name: string; value: string }>;
};

export const firstEmbed = (
  body: RESTPostAPIChannelMessageJSONBody | undefined
): EmbedJson => (body?.embeds as unknown as EmbedJson[])[0] as EmbedJson;
