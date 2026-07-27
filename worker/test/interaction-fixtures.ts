/**
 * Fixtures only the interaction and slash command suites need: the raw
 * interaction payloads, the OpenSea-side stubs, and the `waitUntil` and
 * follow-up recorders.
 *
 * Anything shared with another suite lives in `./fixtures`, which is where
 * `stubGlyphBots`, `createBot`, `createArtifact` and `TEST_ORIGIN` come from.
 */

import type {
  APIApplicationCommandInteractionDataOption,
  APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  InteractionType,
} from "discord-api-types/v10";
import { vi } from "vitest";
import type { OpenSeaClient } from "../src/api/opensea";
import type {
  BotStory,
  OpenSeaCollectionStats,
  OpenSeaEvent,
  OpenSeaListing,
  OpenSeaNFT,
} from "../src/api/types";
import type { CommandContext } from "../src/commands/context";
import { readOptions } from "../src/commands/context";
import type { EditOriginal, FollowUp } from "../src/discord/interactions";
import { stubGlyphBots } from "./fixtures";

export const APP_ID = "111111111111111111";

/** Option literals, so tests read like the slash command they stand for. */
export const intOption = (
  name: string,
  value: number
): APIApplicationCommandInteractionDataOption => ({
  name,
  type: ApplicationCommandOptionType.Integer,
  value,
});

export const boolOption = (
  name: string,
  value: boolean
): APIApplicationCommandInteractionDataOption => ({
  name,
  type: ApplicationCommandOptionType.Boolean,
  value,
});

export const stringOption = (
  name: string,
  value: string
): APIApplicationCommandInteractionDataOption => ({
  name,
  type: ApplicationCommandOptionType.String,
  value,
});

/** A chat-input interaction, complete enough for the route to accept it. */
export const commandInteraction = (
  name: string,
  options: APIApplicationCommandInteractionDataOption[] = []
): APIChatInputApplicationCommandInteraction =>
  ({
    id: "999",
    application_id: APP_ID,
    type: InteractionType.ApplicationCommand,
    token: "interaction-token",
    version: 1,
    locale: "en-US",
    entitlements: [],
    authorizing_integration_owners: {},
    data: {
      id: "cmd-1",
      name,
      type: ApplicationCommandType.ChatInput,
      options,
    },
    member: {
      user: { id: "user-1", username: "tester", discriminator: "0" },
    },
  }) as unknown as APIChatInputApplicationCommandInteraction;

export const createStory = (overrides: Partial<BotStory> = {}): BotStory => ({
  arc: {
    id: "arc-1",
    title: "The Long Signal",
    role: "Scout",
    faction: "Driftwatch",
    snippet: "…",
  },
  storySeed: 1,
  storyPowers: ["Echo Sense", "Static Veil", "Null Step", "Fourth Power"],
  storyStats: { strength: 40, agility: 70 },
  storySnippet: "…",
  missionBrief: "…",
  ...overrides,
});

export const createNFT = (overrides: Partial<OpenSeaNFT> = {}): OpenSeaNFT => ({
  identifier: "7",
  collection: "glyphbots",
  contract: "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075",
  token_standard: "erc721",
  name: "GlyphBot #7",
  opensea_url: "https://opensea.io/assets/ethereum/0xb6c2/7",
  owners: [
    { address: "0x1234567890abcdef1234567890abcdef12345678", quantity: 1 },
  ],
  rarity: { strategy_id: "openrarity", strategy_version: "1", rank: 42 },
  ...overrides,
});

export const createStats = (): OpenSeaCollectionStats => ({
  total: {
    volume: 1234.5,
    sales: 321,
    num_owners: 2100,
    market_cap: 5000,
    floor_price: 0.045,
    floor_price_symbol: "ETH",
    average_price: 0.12,
  },
  intervals: [
    {
      interval: "one_day",
      volume: 1.5,
      volume_diff: 0,
      volume_change: 0.1,
      sales: 3,
      sales_diff: 0,
      average_price: 0.5,
    },
    {
      interval: "seven_day",
      volume: 10,
      volume_diff: 0,
      volume_change: -0.25,
      sales: 12,
      sales_diff: 0,
      average_price: 0.8,
    },
    {
      interval: "thirty_day",
      volume: 40,
      volume_diff: 0,
      volume_change: 0.05,
      sales: 55,
      sales_diff: 0,
      average_price: 0.7,
    },
  ],
});

export const createSaleEvent = (
  overrides: Partial<OpenSeaEvent> = {}
): OpenSeaEvent => ({
  event_type: "sale",
  event_timestamp: Math.floor(Date.now() / 1000) - 120,
  chain: "ethereum",
  quantity: 1,
  payment: {
    quantity: "500000000000000000",
    token_address: "0x0",
    decimals: 18,
    symbol: "ETH",
  },
  buyer: "0xabcdef1234567890abcdef1234567890abcdef12",
  nft: { identifier: "7", name: "GlyphBot #7" },
  ...overrides,
});

export const createListing = (value = "45000000000000000"): OpenSeaListing => ({
  order_hash: "0xhash",
  chain: "ethereum",
  price: { current: { currency: "ETH", decimals: 18, value } },
  protocol_data: {
    parameters: { offerer: "0x9999990000000000000000000000000000000042" },
  },
  protocol_address: "0xseaport",
});

/**
 * A listing with holes in it, which is not what `OpenSeaListing` declares.
 *
 * Best-listings is the least reliable endpoint this bot reads: a listing
 * caught mid-cancellation comes back with the wrapper and nothing under it.
 * The cast is the point of the fixture, and taking a nested `Partial` keeps
 * the field names checked so a test cannot pass by misspelling one.
 */
export const partialListing = (listing: {
  price?: { current?: Partial<OpenSeaListing["price"]["current"]> };
  protocol_data?: {
    parameters?: Partial<OpenSeaListing["protocol_data"]["parameters"]>;
  };
}): OpenSeaListing => listing as OpenSeaListing;

/**
 * Collection stats as OpenSea actually serves them on a partial index, which
 * is not what `OpenSeaCollectionStats` declares.
 *
 * The cast is the whole point of the fixture: `/floor` has to survive fields
 * the type says are always numbers. Taking a `Partial` rather than `never`
 * keeps the field *names* checked, so a test cannot pass by misspelling one.
 */
export const partialStats = (stats: {
  total?: Partial<OpenSeaCollectionStats["total"]>;
  intervals?: Array<Partial<OpenSeaCollectionStats["intervals"][number]>>;
}): OpenSeaCollectionStats => stats as OpenSeaCollectionStats;

export const stubOpenSea = (
  overrides: Partial<OpenSeaClient> = {}
): OpenSeaClient => ({
  fetchAccount: vi.fn(() => Promise.resolve(null)),
  fetchAccountNFTs: vi.fn(() => Promise.resolve([])),
  fetchCollectionEvents: vi.fn(() => Promise.resolve([])),
  fetchCollectionEventsSince: vi.fn(() =>
    Promise.resolve({ events: [], pages: 1, failed: false, truncated: false })
  ),
  fetchCollectionStats: vi.fn(() => Promise.resolve(null)),
  fetchListings: vi.fn(() => Promise.resolve([])),
  fetchNFT: vi.fn(() => Promise.resolve(null)),
  fetchNFTEvents: vi.fn(() => Promise.resolve([])),
  ...overrides,
});

export const commandContext = (
  overrides: Partial<CommandContext> = {}
): CommandContext => ({
  glyphbots: stubGlyphBots(),
  opensea: stubOpenSea(),
  options: readOptions([]),
  userId: "user-1",
  ...overrides,
});

/** Records the follow-up PATCHes instead of making them. */
export const recordingEditOriginal = () => {
  const calls: FollowUp[] = [];
  const editOriginal: EditOriginal = (_appId, _token, body) => {
    calls.push(body);
    return Promise.resolve(true);
  };
  return { calls, editOriginal };
};

/** Collects `waitUntil` promises so a test can await them. */
export const collectingWaitUntil = () => {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    waitUntil: (promise: Promise<unknown>) => {
      promises.push(promise);
    },
    settle: () => Promise.all(promises),
  };
};
