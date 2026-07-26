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
