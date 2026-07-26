/**
 * Guild ids and mint-watcher tuning.
 *
 * Discord ids are inline constants, never env vars, matching Coral's rule in
 * `/Users/rg/dev/coral/AGENTS.md`. The only environment values are the bot's
 * own credentials.
 */

/** GlyphBots guild. */
export const GUILD_ID = "1445933082938183743";

/** #general. Mints land here. */
export const GENERAL_CHANNEL_ID = "1445933084401864767";

/** Channel the mint watcher posts into. */
export const MINTS_CHANNEL_ID = GENERAL_CHANNEL_ID;

/**
 * Production GlyphBots API origin.
 *
 * Must be the `www` host. The apex 307-redirects to it on every API path, and
 * on Workers each redirect burns a subrequest, so pointing at the apex doubles
 * the request count for no reason. It also breaks outright if a fetch here ever
 * moves to `redirect: "manual"`.
 */
export const DEFAULT_GLYPHBOTS_API_URL = "https://www.glyphbots.com";

/** Artifacts pulled per poll (`src/channels/mints.ts` FETCH_LIMIT). */
export const MINTS_FETCH_LIMIT = 50;

/** Burst guard ceiling (`src/lib/constants.ts:49`). */
export const MINTS_MAX_POSTS_PER_POLL = 5;

/** Pause between individual mint posts, to stay clear of the channel bucket. */
export const MINTS_POST_DELAY_MS = 1500;

/** How many posted artifact ids the cursor remembers (`src/lib/state.ts:17`). */
export const MINTS_POSTED_ID_HISTORY = 100;

/** GlyphBots brand color for embeds. */
export const GLYPHBOTS_COLOR = 0x00ff88;

/** Etherscan transaction base URL. */
export const ETHERSCAN_TX_URL = "https://etherscan.io/tx/";

/** OpenSea v2 API root (`src/api/opensea.ts:18`). */
export const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";

/** Bot contract (`src/api/opensea.ts:19`). */
export const GLYPHBOTS_CONTRACT = "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075";

/** Artifact contract (`src/commands/artifact.ts:23`). */
export const ARTIFACTS_CONTRACT = "0x3c64dc415de60ee9a25f67fb48e7c9a234a4b6d1";

/** OpenSea collection slug (`src/api/opensea.ts:20`). */
export const GLYPHBOTS_COLLECTION_SLUG = "glyphbots";

/** Chain every OpenSea path is scoped to. */
export const OPENSEA_CHAIN = "ethereum";

/** Highest bot token id, and the denominator on every rarity rank. */
export const MAX_BOT_TOKEN_ID = 11_111;

/**
 * Embed colors, ported from the per-command `HexColorString` constants. They
 * are numbers here because `@discordjs/builders`'s `setColor` takes a number
 * or an RGB tuple; the `"#rrggbb"` overload is a discord.js addition.
 */
export const COLORS = {
  /** `src/commands/activity.ts:15` */
  activity: 0xe6_7e_22,
  /** `src/commands/artifact.ts:21` */
  artifact: 0x9b_59_b6,
  /** `src/commands/bot.ts:27` */
  bot: 0x00_ff_88,
  /** Shared error red, `src/commands/*.ts` */
  error: 0xff_44_44,
  /** `src/commands/owner.ts:20` */
  info: 0x58_65_f2,
  /** `src/commands/listings.ts:18` */
  listing: 0x34_98_db,
  /** `src/commands/rarity.ts:15` */
  rarity: 0x9b_59_b6,
  /** `src/commands/sales.ts:19` */
  sale: 0x2e_cc_71,
  /** `src/commands/floor.ts:14` */
  stats: 0xf5_a6_23,
} as const;
