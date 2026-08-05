/**
 * GlyphBots and OpenSea API shapes.
 *
 * One deliberate omission: the OpenSea types below drop `image_url` and
 * `display_image_url`, which the Node types carried. OpenSea serves
 * `image/svg+xml` for the bots contract (verified live on token 1) and Discord
 * renders nothing for SVG, so an OpenSea image URL must never reach an embed.
 * Leaving the fields off the type makes that a compile error rather than a
 * code-review rule. Bot imagery comes from `GlyphBotsClient.getBotPngUrl`.
 *
 * The artifacts contract is not the same hazard and the fields stay off it
 * anyway. OpenSea serves a JPEG there (an `i2c.seadn.io` URL, verified
 * 2026-08-04) which would render fine, but it is a re-host of a picture the
 * GlyphBots API hands out first-party. Artifact art comes from
 * `GlyphBotsClient.fetchArtifact`, everywhere, so there is one source for it.
 */

export type Artifact = {
  id: string;
  botTokenId: number;
  imageUrl: string;
  // The site never guarantees a title; extraction from the model output can
  // come back empty, and the API stores null. Render a fallback, never "null".
  title: string | null;
  createdAt: string;
  mintedAt: string | null;
  contractTokenId: number | null;
  mintQuantity: number | null;
  aicArtworkIds?: number[];
  minter: string | null;
  imageCid?: string;
  mintTxHash?: string;
  sourceBotIds?: number[];
  durationMs?: number;
  type: string | null;
};

/**
 * `/api/artifacts/recently-minted?summary=true`.
 *
 * Four counts and nothing else, and note what they are not: `last1d` is a
 * rolling 24 hours rather than "today", and `total` is minted artifacts rather
 * than anything about bots. Verified live 2026-07-26, which returned
 * `{"total":173,"last1d":0,"last7d":2,"last30d":2}`. The summary branch answers
 * a bare object with no `ok` envelope, unlike the list branch below.
 */
export type ArtifactSummary = {
  total: number;
  last1d: number;
  last7d: number;
  last30d: number;
};

export type ArtifactsListResponse = {
  ok: boolean;
  items: Artifact[];
  nextCursor?: string | null;
  error?: string;
};

export type Trait = {
  trait_type: string;
  value: string;
};

export type Bot = {
  id: string;
  name: string;
  tokenId: number;
  traits: Trait[];
  rarityRank: number;
  burnedAt: string | null;
  burnedBy: string | null;
};

export type StoryArc = {
  id: string;
  title: string;
  role: string;
  faction: string;
  snippet: string;
};

export type BotStory = {
  arc: StoryArc;
  storySeed: number;
  storyPowers: string[];
  storyStats: Record<string, number>;
  storySnippet: string;
  missionBrief: string;
};

export type BotStoryResponse = {
  story: BotStory | null;
  error?: string;
};

export type BotResponse = {
  bot: Bot;
};

export type ArtifactResponse = {
  ok: boolean;
  artifact?: Artifact;
  error?: string;
};

/** OpenSea API shapes. See the note at the top about the missing image fields. */

/**
 * `/accounts/{address_or_username}`.
 *
 * Three name fields, and they are not interchangeable. `username` is the handle
 * the holder picked on OpenSea and most addresses do not have one. `ens_name`
 * is the reverse record OpenSea resolved for them, which is where nearly every
 * recognisable name in this collection comes from. `display_name` is OpenSea's
 * own pick between the two and is read last, purely as a backstop for the case
 * where it knows a name the other two fields do not carry.
 *
 * All three come back as JSON `null` rather than absent for an address OpenSea
 * has nothing on (verified live 2026-07-27), hence `| null` and not just `?`.
 * See `preferredName` in `./display-name.ts` for the order they are read in.
 */
export type OpenSeaAccount = {
  address: string;
  username?: string | null;
  ens_name?: string | null;
  display_name?: string | null;
  bio?: string | null;
};

export type OpenSeaNFTOwner = {
  address: string;
  quantity: number;
};

export type OpenSeaTrait = {
  trait_type: string;
  display_type: string | null;
  max_value: string | null;
  value: string;
};

export type OpenSeaNFT = {
  identifier: string;
  collection: string;
  contract: string;
  token_standard: string;
  name?: string;
  description?: string;
  opensea_url: string;
  traits?: OpenSeaTrait[];
  owners?: OpenSeaNFTOwner[];
  rarity?: {
    strategy_id: string;
    strategy_version: string;
    rank: number;
  };
};

export type OpenSeaNFTResponse = {
  nft: OpenSeaNFT;
};

export type AccountNFT = {
  identifier: string;
  collection: string;
  contract: string;
  name?: string;
};

export type AccountNFTsResponse = {
  nfts: AccountNFT[];
  next?: string;
};

export type OpenSeaCollectionStatsInterval = {
  interval: string;
  volume: number;
  volume_diff: number;
  volume_change: number;
  sales: number;
  sales_diff: number;
  average_price: number;
};

export type OpenSeaCollectionStats = {
  total: {
    volume: number;
    sales: number;
    num_owners: number;
    market_cap: number;
    floor_price: number;
    floor_price_symbol: string;
    average_price: number;
  };
  intervals: OpenSeaCollectionStatsInterval[];
};

export type OpenSeaPayment = {
  quantity: string;
  token_address: string;
  decimals: number;
  symbol: string;
};

export type OpenSeaEvent = {
  event_type: string;
  event_timestamp: number;
  chain: string;
  transaction?: string;
  payment?: OpenSeaPayment;
  quantity: number;
  seller?: string;
  buyer?: string;
  from_address?: string;
  to_address?: string;
  /**
   * Seaport deployment the order settled through. A sale carries this and
   * `order_hash` together, and both are needed to look the filled order back up
   * and find out which side signed it. See `../channels/sale-kind.ts`.
   */
  protocol_address?: string;
  /**
   * Order fields, present on `event_type: "order"` responses. The v2 API
   * reports listings and offers under one `order` event type and puts the
   * real one in `order_type`, which is the quirk
   * `opensea-activity-bot/src/utils/event-types.ts:15-24` exists to unpick.
   * Only the sales feed reads these, and only to classify what it is choosing
   * not to post.
   */
  order_type?: string;
  order_hash?: string;
  maker?: string;
  expiration_date?: number;
  nft?: {
    identifier: string;
    /**
     * OpenSea slug, and the first thing `../api/collections.ts` reads to decide
     * whether this is a bot or an artifact. Live payloads carry it alongside
     * `contract` (verified 2026-08-04); both are optional here because the
     * sweep's own filters, not this field, are what guarantee the event is in
     * scope.
     */
    collection?: string;
    contract?: string;
    name?: string;
    opensea_url?: string;
  };
};

export type OpenSeaEventsResponse = {
  asset_events: OpenSeaEvent[];
  next?: string;
};

/** One `offer` or `consideration` entry inside a Seaport order. */
export type OpenSeaOrderItem = {
  /** A Seaport `ItemType`. See `SEAPORT_ITEM_TYPE` in `../channels/sale-kind.ts`. */
  itemType: number;
  token: string;
  identifierOrCriteria: string;
  startAmount: string;
  endAmount: string;
};

/**
 * `/orders/chain/{chain}/protocol/{protocol_address}/{order_hash}`.
 *
 * The response has no `side` field, so which side of the trade signed the order
 * is read off `protocol_data.parameters.offer`: an NFT there is a listing, an
 * ERC-20 there is a bid. `criteria` is what separates a collection offer from a
 * trait offer from a plain one, and it is null on listings. Only the sales feed
 * reads any of this, and only to word the post.
 *
 * A filled order still resolves (status `FULFILLED`, verified live 2026-07-27),
 * which is what makes this usable after the fact rather than only while the
 * order is live.
 */
export type OpenSeaOrder = {
  order_hash: string;
  status?: string;
  criteria?: {
    collection?: { slug?: string } | null;
    contract?: { address?: string } | null;
    trait?: { type?: string; value?: string } | null;
  } | null;
  protocol_data?: {
    parameters?: {
      offerer?: string;
      offer?: OpenSeaOrderItem[];
      consideration?: OpenSeaOrderItem[];
    };
  };
};

export type OpenSeaOrderResponse = {
  order: OpenSeaOrder;
};

export type OpenSeaListing = {
  order_hash: string;
  chain: string;
  price: {
    current: {
      currency: string;
      decimals: number;
      value: string;
    };
  };
  protocol_data: {
    parameters: {
      offerer: string;
    };
  };
  protocol_address: string;
};

export type OpenSeaListingsResponse = {
  listings: OpenSeaListing[];
  next?: string;
};
