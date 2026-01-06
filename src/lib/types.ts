/** GlyphBots API Types */

export type Trait = {
  trait_type: string;
  value: string;
};

export type UnicodeInfo = {
  unicode: string[];
  textContent: string[];
  colors: {
    background: string;
    text: string;
  };
};

export type Bot = {
  id: string;
  name: string;
  tokenId: number;
  traits: Trait[];
  rarityRank: number;
  unicode: UnicodeInfo;
  burnedAt: string | null;
  burnedBy: string | null;
};

export type MissionInfo = {
  type: string;
  objective: string;
  setting: string;
  threat: string;
  mechanic: string;
  timeContext: string;
  stakesSuccess: string;
  stakesFailure: string;
};

export type Ability = {
  name: string;
  effect: string;
  cooldown: string;
  resource: string;
};

export type StoryArc = {
  id: string;
  title: string;
  role: string;
  faction: string;
  mission: MissionInfo;
  abilities: Ability[];
  symbolBias: string[];
  environmentObjects: string[];
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

/** Artifact Types */

export type Artifact = {
  id: string;
  botTokenId: number;
  imageUrl: string;
  title: string;
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

export type ArtifactsListResponse = {
  ok: boolean;
  items: Artifact[];
  nextCursor?: string | null;
  error?: string;
};

export type ArtifactResponse = {
  ok: boolean;
  artifact?: Artifact;
  error?: string;
};

export type ArtifactsSummaryResponse = {
  total: number;
  last1d: number;
  last7d: number;
  last30d: number;
};

/** Lore Generation Types */

export type LoreContext = {
  artifact: Artifact;
  bot: Bot;
  story: BotStory | null;
};

export type GeneratedLore = {
  title: string;
  narrative: string;
  artifact: Artifact;
  bot: Bot;
};

/** Configuration Types */

export type Config = {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string | null;
  loreChannelId: string;
  loreMinIntervalMinutes: number;
  loreMaxIntervalMinutes: number;
  arenaChannelId: string | null;
  arenaChallengeTimeoutSeconds: number;
  arenaRoundTimeoutSeconds: number;
  arenaMaxRounds: number;
  playgroundChannelId: string | null;
  playgroundMinIntervalMinutes: number;
  playgroundMaxIntervalMinutes: number;
  googleAiApiKey: string;
  glyphbotsApiUrl: string;
  logLevel: string;
};

/** OpenSea API Types */

export type OpenSeaAccount = {
  address: string;
  username?: string;
  profile_image_url?: string;
  banner_image_url?: string;
  website?: string;
  bio?: string;
  joined_date?: string;
  social_media_accounts?: Array<{
    platform: string;
    username: string;
  }>;
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
  image_url?: string;
  display_image_url?: string;
  opensea_url: string;
  updated_at: string;
  is_disabled: boolean;
  is_nsfw: boolean;
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
  token_standard: string;
  name?: string;
  description?: string;
  image_url?: string;
  display_image_url?: string;
  opensea_url: string;
  updated_at: string;
  is_disabled: boolean;
  is_nsfw: boolean;
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
  nft?: {
    identifier: string;
    name?: string;
    image_url?: string;
    opensea_url?: string;
  };
};

export type OpenSeaEventsResponse = {
  asset_events: OpenSeaEvent[];
  next?: string;
};

export type OpenSeaListingPrice = {
  current: {
    currency: string;
    decimals: number;
    value: string;
  };
};

export type OpenSeaListing = {
  order_hash: string;
  chain: string;
  price: OpenSeaListingPrice;
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
