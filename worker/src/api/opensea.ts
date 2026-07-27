/**
 * OpenSea v2 client.
 *
 * The Node version destructured `process.env.OPENSEA_API_TOKEN` at module
 * scope (`src/api/opensea.ts:23-31` at `c75d6a8`) and froze it into a shared
 * `GET_OPTS` header object. On Workers the module body runs before any binding
 * exists, so every call would ship `X-API-KEY: ""` and get rate limited. Here
 * the token is a factory argument, the same shape `createGlyphBotsClient` uses,
 * and the headers are rebuilt per client.
 *
 * A missing token is not fatal. OpenSea serves the public endpoints unkeyed at
 * a much lower rate limit, which is the behavior the Node bot already had when
 * the variable was unset, so the client warns once and carries on.
 *
 * Note what this client does NOT return: image URLs. OpenSea's `image_url` for
 * this contract is `image/svg+xml` and Discord renders nothing for SVG, so the
 * field is dropped from the types in `./types` and bot imagery always comes
 * from `GlyphBotsClient.getBotPngUrl`.
 */

import {
  ARTIFACTS_CONTRACT,
  GLYPHBOTS_COLLECTION_SLUG,
  GLYPHBOTS_CONTRACT,
  OPENSEA_API_BASE,
  OPENSEA_CHAIN,
  SALES_FETCH_LIMIT,
  SALES_MAX_PAGES,
} from "../config";
import { createLogger, getErrorMessage } from "../utils/logger";
import type {
  AccountNFT,
  AccountNFTsResponse,
  OpenSeaAccount,
  OpenSeaCollectionStats,
  OpenSeaEvent,
  OpenSeaEventsResponse,
  OpenSeaListing,
  OpenSeaListingsResponse,
  OpenSeaNFT,
  OpenSeaNFTResponse,
} from "./types";

const log = createLogger("OpenSea");

const NOT_FOUND = 404;

export type OpenSeaEventType = "sale" | "transfer" | "listing";

/** Options for one paginated events sweep. */
export type EventsSinceOptions = {
  /**
   * Unix seconds. OpenSea returns events strictly after this, so the caller
   * subtracts a lag window before passing its cursor in.
   */
  after: number;
  eventTypes: readonly OpenSeaEventType[];
  /** Events per page. */
  limit?: number;
  /** Pages to follow at most, counting the first. */
  maxPages?: number;
};

export type EventsSincePage = {
  /** Oldest first, which is the order the feed posts in. */
  events: OpenSeaEvent[];
  pages: number;
  /**
   * True when a request came back empty because it failed rather than because
   * there was nothing there. The caller must not advance its cursor at all.
   */
  failed: boolean;
  /**
   * True when the page budget ran out with more still behind the last cursor.
   *
   * This is not the same as `failed` and the difference matters: the sweep
   * succeeded, it just did not finish. OpenSea serves newest first, so the
   * events it never reached are the OLDEST in the window, and a caller that
   * advances its cursor to the newest event it saw steps straight over them.
   * See `advanceSalesCursor` in `../channels/sales.ts`.
   */
  truncated: boolean;
};

export type OpenSeaClient = {
  fetchAccount: (address: string) => Promise<OpenSeaAccount | null>;
  fetchAccountNFTs: (address: string, limit?: number) => Promise<AccountNFT[]>;
  fetchCollectionEvents: (
    eventType: OpenSeaEventType,
    limit?: number
  ) => Promise<OpenSeaEvent[]>;
  /**
   * `collectPaginatedEvents` from
   * `opensea-activity-bot/src/opensea.ts:479-556`, with the module-level
   * config turned into arguments.
   */
  fetchCollectionEventsSince: (
    options: EventsSinceOptions
  ) => Promise<EventsSincePage>;
  fetchCollectionStats: () => Promise<OpenSeaCollectionStats | null>;
  fetchListings: (limit?: number) => Promise<OpenSeaListing[]>;
  fetchNFT: (tokenId: number) => Promise<OpenSeaNFT | null>;
  fetchNFTEvents: (tokenId: number, limit?: number) => Promise<OpenSeaEvent[]>;
};

/**
 * Build a client bound to one API token. Call this from the request handler
 * with the live `env`, never at module scope.
 */
export const createOpenSeaClient = (
  env: { OPENSEA_API_TOKEN?: string } = {}
): OpenSeaClient => {
  const token = env.OPENSEA_API_TOKEN ?? "";

  if (!token) {
    log.warn("OPENSEA_API_TOKEN is not set, falling back to the public tier");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers["X-API-KEY"] = token;
  }

  /** Every read goes through here. A failure is `null`, never a throw. */
  const get = async <T>(url: string): Promise<T | null> => {
    try {
      log.debug(`Fetching: ${url}`);
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        if (response.status === NOT_FOUND) {
          log.debug(`Not found: ${url}`);
          return null;
        }
        log.warn(`API error ${response.status} for ${url}`);
        return null;
      }

      return (await response.json()) as T;
    } catch (error) {
      log.error(`Request failed for ${url}: ${getErrorMessage(error)}`);
      return null;
    }
  };

  const fetchAccountNFTs = async (
    address: string,
    limit = 50
  ): Promise<AccountNFT[]> => {
    const params = new URLSearchParams({
      collection: GLYPHBOTS_COLLECTION_SLUG,
      limit: limit.toString(),
    });
    const result = await get<AccountNFTsResponse>(
      `${OPENSEA_API_BASE}/chain/${OPENSEA_CHAIN}/account/${address}/nfts?${params}`
    );
    return result?.nfts ?? [];
  };

  const eventsUrl = (params: URLSearchParams): string =>
    `${OPENSEA_API_BASE}/events/collection/${GLYPHBOTS_COLLECTION_SLUG}?${params}`;

  /**
   * Follow `next` until the collection runs out, a page comes back short, or
   * the page budget is spent.
   *
   * Three guards carried over from the Node version verbatim, because each one
   * is there for an observed failure: stop when a page returns fewer rows than
   * the limit (there is nothing behind it), stop when the API hands back the
   * cursor it was just given (it does), and stop at `maxPages` regardless.
   *
   * Only the first two mean "that was all of it". The third means "there is
   * more and I ran out of budget", which is why it is reported separately as
   * `truncated` rather than being indistinguishable from a finished sweep.
   *
   * One deliberate difference. The Node version builds the next URL as
   * `${getEvents()}?${result.next}`, treating `next` as an entire query string,
   * which drops `after` and the event type filters on every page after the
   * first. Here `next` is passed as one parameter alongside the original
   * filters, which is what the v2 API documents.
   */
  const fetchCollectionEventsSince = async (
    options: EventsSinceOptions
  ): Promise<EventsSincePage> => {
    const limit = options.limit ?? SALES_FETCH_LIMIT;
    const maxPages = options.maxPages ?? SALES_MAX_PAGES;

    const baseParams = (): URLSearchParams => {
      const params = new URLSearchParams({
        after: String(Math.max(0, Math.floor(options.after))),
        limit: String(limit),
      });
      for (const eventType of options.eventTypes) {
        params.append("event_type", eventType);
      }
      return params;
    };

    const collected: OpenSeaEvent[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let truncated = false;

    while (pages < maxPages) {
      const params = baseParams();
      if (cursor) {
        params.set("next", cursor);
      }

      const page = await get<OpenSeaEventsResponse>(eventsUrl(params));
      pages += 1;

      if (!page) {
        log.warn(`Events page ${pages} failed, stopping the sweep here`);
        return {
          events: collected.reverse(),
          pages,
          failed: true,
          truncated: false,
        };
      }

      const batch = page.asset_events ?? [];
      collected.push(...batch);

      // `cursor` is what this request carried, so `page.next === cursor` is the
      // API handing back the cursor it was just given. Comparing against the
      // cursor from the request before that made this an A-B-A detector that
      // fired a page late and collected the same batch twice.
      if (batch.length < limit || !page.next || page.next === cursor) {
        break;
      }

      cursor = page.next;

      if (pages >= maxPages) {
        truncated = true;
        log.warn(
          `Events sweep stopped at the ${maxPages} page ceiling with more behind it; the oldest events in this window were not fetched`
        );
      }
    }

    if (pages > 1) {
      log.debug(
        `Events sweep followed ${pages} pages, ${collected.length} events`
      );
    }

    // OpenSea serves newest first. The feed posts chronologically, and the
    // cursor is the max timestamp handled, so reverse once here.
    return { events: collected.reverse(), pages, failed: false, truncated };
  };

  return {
    fetchAccount: (address) =>
      get<OpenSeaAccount>(`${OPENSEA_API_BASE}/accounts/${address}`),

    fetchAccountNFTs,

    fetchCollectionEventsSince,

    fetchCollectionEvents: async (eventType, limit = 10) => {
      const params = new URLSearchParams({
        event_type: eventType,
        limit: limit.toString(),
      });
      const result = await get<OpenSeaEventsResponse>(
        `${OPENSEA_API_BASE}/events/collection/${GLYPHBOTS_COLLECTION_SLUG}?${params}`
      );
      return result?.asset_events ?? [];
    },

    fetchCollectionStats: () =>
      get<OpenSeaCollectionStats>(
        `${OPENSEA_API_BASE}/collections/${GLYPHBOTS_COLLECTION_SLUG}/stats`
      ),

    fetchListings: async (limit = 10) => {
      const params = new URLSearchParams({ limit: limit.toString() });
      const result = await get<OpenSeaListingsResponse>(
        `${OPENSEA_API_BASE}/listings/collection/${GLYPHBOTS_COLLECTION_SLUG}/best?${params}`
      );
      return result?.listings ?? [];
    },

    fetchNFT: async (tokenId) => {
      const result = await get<OpenSeaNFTResponse>(
        `${OPENSEA_API_BASE}/chain/${OPENSEA_CHAIN}/contract/${GLYPHBOTS_CONTRACT}/nfts/${tokenId}`
      );
      return result?.nft ?? null;
    },

    fetchNFTEvents: async (tokenId, limit = 10) => {
      const params = new URLSearchParams({ limit: limit.toString() });
      const result = await get<OpenSeaEventsResponse>(
        `${OPENSEA_API_BASE}/events/chain/${OPENSEA_CHAIN}/contract/${GLYPHBOTS_CONTRACT}/nfts/${tokenId}?${params}`
      );
      return result?.asset_events ?? [];
    },
  };
};

/** Marketplace URL for one bot (`src/api/opensea.ts:139` at `c75d6a8`). */
export const getOpenSeaUrl = (tokenId: number): string =>
  `https://opensea.io/assets/ethereum/${GLYPHBOTS_CONTRACT}/${tokenId}`;

/** Marketplace URL for one artifact (`src/commands/artifact.ts:83` at `c75d6a8`). */
export const getOpenSeaArtifactUrl = (tokenId: number): string =>
  `https://opensea.io/assets/ethereum/${ARTIFACTS_CONTRACT}/${tokenId}`;

/** Marketplace URL for the collection (`src/api/opensea.ts:142` at `c75d6a8`). */
export const getOpenSeaCollectionUrl = (): string =>
  `https://opensea.io/collection/${GLYPHBOTS_COLLECTION_SLUG}`;
