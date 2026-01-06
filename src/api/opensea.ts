import { prefixedLogger } from "../lib/logger";
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
} from "../lib/types";
import { getErrorMessage } from "../lib/utils";

const log = prefixedLogger("OpenSea");

const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const GLYPHBOTS_CONTRACT = "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075";
const GLYPHBOTS_COLLECTION_SLUG = "glyphbots";
const CHAIN = "ethereum";

const { OPENSEA_API_TOKEN } = process.env;

const GET_OPTS = {
  method: "GET",
  headers: {
    Accept: "application/json",
    "X-API-KEY": OPENSEA_API_TOKEN ?? "",
  },
} as const;

const openseaGet = async <T>(url: string): Promise<T | undefined> => {
  const startTime = Date.now();

  try {
    log.debug(`Fetching: ${url}`);
    const response = await fetch(url, GET_OPTS);
    const duration = Date.now() - startTime;

    if (!response.ok) {
      if (response.status === 404) {
        log.debug(`Not found: ${url} (${duration}ms)`);
        return;
      }

      log.warn(
        `API error ${response.status} for ${url} (${duration}ms): ${response.statusText}`
      );
      return;
    }

    log.debug(`Success: ${url} (${duration}ms)`);
    return (await response.json()) as T;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error(
      `Request failed for ${url} (${duration}ms): ${getErrorMessage(error)}`
    );
  }
};

const urls = {
  account: (address: string) => `${OPENSEA_API_BASE}/accounts/${address}`,

  nft: (tokenId: number) =>
    `${OPENSEA_API_BASE}/chain/${CHAIN}/contract/${GLYPHBOTS_CONTRACT}/nfts/${tokenId}`,

  collectionStats: () =>
    `${OPENSEA_API_BASE}/collections/${GLYPHBOTS_COLLECTION_SLUG}/stats`,

  accountNFTs: (address: string, limit = 50) => {
    const params = new URLSearchParams({
      collection: GLYPHBOTS_COLLECTION_SLUG,
      limit: limit.toString(),
    });
    return `${OPENSEA_API_BASE}/chain/${CHAIN}/account/${address}/nfts?${params}`;
  },
};

export const fetchAccount = (
  address: string
): Promise<OpenSeaAccount | undefined> => {
  log.debug(`Fetching account: ${address}`);
  return openseaGet<OpenSeaAccount>(urls.account(address));
};

export const fetchNFT = async (
  tokenId: number
): Promise<OpenSeaNFT | undefined> => {
  log.debug(`Fetching NFT: #${tokenId}`);
  const result = await openseaGet<OpenSeaNFTResponse>(urls.nft(tokenId));
  return result?.nft;
};

export const fetchCollectionStats = (): Promise<
  OpenSeaCollectionStats | undefined
> => {
  log.debug("Fetching GlyphBots collection stats");
  return openseaGet<OpenSeaCollectionStats>(urls.collectionStats());
};

export const fetchAccountNFTs = async (
  address: string,
  limit = 50
): Promise<AccountNFT[]> => {
  log.debug(`Fetching NFTs for ${address}`);
  const result = await openseaGet<AccountNFTsResponse>(
    urls.accountNFTs(address, limit)
  );
  return result?.nfts ?? [];
};

export const fetchRandomUserNFT = async (
  address: string
): Promise<AccountNFT | undefined> => {
  log.debug(`Fetching random NFT for ${address}`);
  const nfts = await fetchAccountNFTs(address);

  if (nfts.length === 0) {
    log.debug(`No NFTs found for ${address}`);
    return;
  }

  const randomIndex = Math.floor(Math.random() * nfts.length);
  const nft = nfts[randomIndex];
  log.debug(`Selected random NFT: ${nft.name ?? `#${nft.identifier}`}`);
  return nft;
};

export const shortAddress = (addr: string): string =>
  `${addr.slice(0, 7)}…${addr.slice(37, 42)}`;

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const isValidEthereumAddress = (address: string): boolean =>
  ETH_ADDRESS_REGEX.test(address);

export const getOpenSeaUrl = (tokenId: number): string =>
  `https://opensea.io/assets/ethereum/${GLYPHBOTS_CONTRACT}/${tokenId}`;

export const getOpenSeaCollectionUrl = (): string =>
  `https://opensea.io/collection/${GLYPHBOTS_COLLECTION_SLUG}`;

export const fetchCollectionEvents = async (
  eventType: "sale" | "transfer" | "listing",
  limit = 10
): Promise<OpenSeaEvent[]> => {
  log.debug(`Fetching ${eventType} events`);
  const params = new URLSearchParams({
    event_type: eventType,
    limit: limit.toString(),
  });
  const url = `${OPENSEA_API_BASE}/events/collection/${GLYPHBOTS_COLLECTION_SLUG}?${params}`;
  const result = await openseaGet<OpenSeaEventsResponse>(url);
  return result?.asset_events ?? [];
};

export const fetchListings = async (limit = 10): Promise<OpenSeaListing[]> => {
  log.debug("Fetching collection listings");
  const params = new URLSearchParams({
    limit: limit.toString(),
  });
  const url = `${OPENSEA_API_BASE}/listings/collection/${GLYPHBOTS_COLLECTION_SLUG}/best?${params}`;
  const result = await openseaGet<OpenSeaListingsResponse>(url);
  return result?.listings ?? [];
};

export const fetchNFTEvents = async (
  tokenId: number,
  limit = 10
): Promise<OpenSeaEvent[]> => {
  log.debug(`Fetching events for NFT #${tokenId}`);
  const params = new URLSearchParams({
    limit: limit.toString(),
  });
  const url = `${OPENSEA_API_BASE}/events/chain/${CHAIN}/contract/${GLYPHBOTS_CONTRACT}/nfts/${tokenId}?${params}`;
  const result = await openseaGet<OpenSeaEventsResponse>(url);
  return result?.asset_events ?? [];
};

export { GLYPHBOTS_CONTRACT, GLYPHBOTS_COLLECTION_SLUG, CHAIN };
