/**
 * OpenSea v2 client, ported from `src/api/opensea.ts`.
 *
 * The Node version destructures `process.env.OPENSEA_API_TOKEN` at module
 * scope (`src/api/opensea.ts:23`) and freezes it into a shared `GET_OPTS`
 * header object (`:24-31`). On Workers the module body runs before any binding
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

export type OpenSeaClient = {
  fetchAccount: (address: string) => Promise<OpenSeaAccount | null>;
  fetchAccountNFTs: (address: string, limit?: number) => Promise<AccountNFT[]>;
  fetchCollectionEvents: (
    eventType: OpenSeaEventType,
    limit?: number
  ) => Promise<OpenSeaEvent[]>;
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

  return {
    fetchAccount: (address) =>
      get<OpenSeaAccount>(`${OPENSEA_API_BASE}/accounts/${address}`),

    fetchAccountNFTs,

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

/** Marketplace URL for one bot (`src/api/opensea.ts:139`). */
export const getOpenSeaUrl = (tokenId: number): string =>
  `https://opensea.io/assets/ethereum/${GLYPHBOTS_CONTRACT}/${tokenId}`;

/** Marketplace URL for one artifact (`src/commands/artifact.ts:83`). */
export const getOpenSeaArtifactUrl = (tokenId: number): string =>
  `https://opensea.io/assets/ethereum/${ARTIFACTS_CONTRACT}/${tokenId}`;

/** Marketplace URL for the collection (`src/api/opensea.ts:142`). */
export const getOpenSeaCollectionUrl = (): string =>
  `https://opensea.io/collection/${GLYPHBOTS_COLLECTION_SLUG}`;
