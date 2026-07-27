/**
 * Guild ids, contracts, colors and the tuning numbers every feed reads.
 *
 * Discord ids are inline constants, never env vars, matching Coral's rule in
 * `/Users/rg/dev/coral/AGENTS.md`. The only environment values are the bot's
 * own credentials.
 *
 * Several numbers below carry the file and line they were taken from. Anything
 * of the form `src/...` at `c75d6a8` is the Node bot that used to live in this
 * repo and was deleted at `0333bac`; anything prefixed with a repo name is one
 * of the two retired bots (`opensea-activity-bot`, `discord-nft-embed-bot`).
 * None of those paths resolve today, which is the point of the qualifier: they
 * are evidence for why a number is what it is, not somewhere to go and look.
 */

/** GlyphBots guild. */
export const GUILD_ID = "1445933082938183743";

/** #general. Mints land here. */
export const GENERAL_CHANNEL_ID = "1445933084401864767";

/** Channel the mint watcher posts into. */
export const MINTS_CHANNEL_ID = GENERAL_CHANNEL_ID;

/** #show-and-tell. Inline lookups are allowed here too. */
export const SHOW_AND_TELL_CHANNEL_ID = "1446248716536123502";

/** #gallery. The random collection post lands here. */
export const GALLERY_CHANNEL_ID = "1445943861263208561";

/** Channel the idle nudge posts into, and the channel it watches for silence. */
export const NUDGE_CHANNEL_ID = GENERAL_CHANNEL_ID;

/** #trading-floor. The OpenSea sales feed lands here. */
export const TRADING_FLOOR_CHANNEL_ID = "1446247601942036574";

/**
 * The only two channels inline `b#123` / `a#123` / `#username` lookups answer
 * in.
 *
 * The bot this is ported from replied in every channel it could see and in DMs
 * (`discord-nft-embed-bot/src/index.ts`, no channel check anywhere).
 * That is the largest subrequest risk in the migration: one embed is several
 * sequential OpenSea calls and a single message can carry six of them, so an
 * unbounded surface is an unbounded bill. Two ids, checked before any network
 * work happens, and a DM has no channel id in this set so it drops too.
 */
export const LOOKUP_CHANNEL_IDS: readonly string[] = [
  GENERAL_CHANNEL_ID,
  SHOW_AND_TELL_CHANNEL_ID,
];

/** Discord's own ceiling, and the Node bot's (`src/config/constants.ts:6` at `c75d6a8`). */
export const MAX_EMBEDS_PER_MESSAGE = 6;

/**
 * Per-channel fixed window for inline lookups, matching Coral's shape
 * (`discord-gateway.ts:156-157`). Ten answered lookups per channel per minute.
 */
export const LOOKUP_RATE_LIMIT_WINDOW_MS = 60_000;
export const LOOKUP_RATE_LIMIT_MAX = 10;

/**
 * Minimum gap between two answered lookups in the same channel. The window
 * above caps the total; this stops all ten being spent in one burst, which is
 * what a copy-pasted list of ids looks like.
 */
export const LOOKUP_COOLDOWN_MS = 3000;

/** Highest artifact token id a lookup will even try. The API rejects the rest. */
export const MAX_ARTIFACT_TOKEN_ID = 100_000;

/**
 * Production GlyphBots API origin.
 *
 * Must be the `www` host. The apex 307-redirects to it on every API path, and
 * on Workers each redirect burns a subrequest, so pointing at the apex doubles
 * the request count for no reason. It also breaks outright if a fetch here ever
 * moves to `redirect: "manual"`.
 */
export const DEFAULT_GLYPHBOTS_API_URL = "https://www.glyphbots.com";

/** Artifacts pulled per poll (`src/channels/mints.ts` FETCH_LIMIT at `c75d6a8`). */
export const MINTS_FETCH_LIMIT = 50;

/** Burst guard ceiling (`src/lib/constants.ts:49` at `c75d6a8`). */
export const MINTS_MAX_POSTS_PER_POLL = 5;

/** Pause between individual mint posts, to stay clear of the channel bucket. */
export const MINTS_POST_DELAY_MS = 1500;

/** How many posted artifact ids the cursor remembers (`src/lib/state.ts:17` at `c75d6a8`). */
export const MINTS_POSTED_ID_HISTORY = 100;

/**
 * OpenSea feed event types the sales tick asks for, and posts.
 *
 * `sale` only, and that is a measurement, not a simplification. Listings run
 * about 176/day against this collection (24 events in a 3.3 hour probe on
 * 2026-07-25, almost all of it one operator's relister), which would put a
 * message in #trading-floor every eight minutes forever. Sales run 1.24/day.
 *
 * The fetch, the settle-window grouping and the actor keys all still
 * understand listings, so that half of the path survives. The embeds do not.
 * `buildSaleEmbed` writes `Purchased:` into the title, `buildGroupEmbed`
 * writes `N items purchased` and labels its actor field `Buyer`, and both read
 * `event.buyer`, which a listing has no value for at all (it carries `maker`).
 * Adding `"listing"` to this array and nothing else would post listings
 * labelled as purchases, with the actor missing. Re-enabling means branching
 * those three strings and the actor lookup on `effectiveEventType` in
 * `src/channels/sales-embeds.ts` first.
 */
export const SALES_EVENT_TYPES: readonly ["sale"] = ["sale"];

/**
 * Seconds subtracted from the cursor before asking OpenSea for events
 * (`opensea-activity-bot/src/opensea.ts:41-44`, applied at `:409-412`).
 *
 * OpenSea indexes events slightly after they happen, so a query that starts
 * exactly at the last seen timestamp misses anything that landed late with an
 * older timestamp. Overlapping the window deliberately re-surfaces events; the
 * processed key set is what stops them being posted twice.
 */
export const SALES_LAG_WINDOW_SECONDS = 120;

/** Events per page. OpenSea's own ceiling is 200. */
export const SALES_FETCH_LIMIT = 50;

/** Pagination ceiling per tick, so one bad cursor cannot spin forever. */
export const SALES_MAX_PAGES = 10;

/**
 * Settle window for actor grouping
 * (`opensea-activity-bot/src/utils/constants.ts:13-14`). A buyer
 * sweeping ten items produces one message rather than ten, and the 60s was
 * originally chosen to let OpenSea metadata populate for mints.
 */
export const SALES_SETTLE_MS = 60_000;

/** Fewest events before a group is a group rather than N singles. */
export const SALES_MIN_GROUP_SIZE = 2;

/**
 * Under-sized groups are dropped at `settleMs * 3`
 * (`opensea-activity-bot/src/utils/event-grouping.ts:353-360`).
 */
export const SALES_GROUP_STALE_MULTIPLIER = 3;

/** Bound on the processed key set, matching the LRU it replaces. */
export const SALES_PROCESSED_KEY_HISTORY = 2000;

/**
 * Messages sent per tick.
 *
 * The Node bot paced itself with a hardcoded 3,000 ms `await timeout` between
 * messages
 * (`opensea-activity-bot/src/platforms/discord/discord.ts:155-157,208-211`).
 * A cron
 * invocation must not sleep, so the pacing becomes a cap: send this many, and
 * carry the rest to the next tick in the deferred queue rather than dropping
 * them.
 */
export const SALES_MAX_MESSAGES_PER_TICK = 5;

/** Ceiling on the deferred queue, so a dead channel cannot grow storage forever. */
export const SALES_DEFERRED_QUEUE_MAX = 50;

/**
 * Items listed inside a grouped message
 * (`opensea-activity-bot/src/platforms/discord/utils.ts:513`).
 */
export const SALES_TOP_ITEMS = 4;

/**
 * Idle nudge and idle-aware `#gallery` tuning.
 *
 * All four numbers are the operator's, and the two that matter are the pair on
 * the nudge: 48 hours of silence before the first post, then no more than one
 * post a day for as long as the silence lasts. The threshold is what makes this
 * a reaction to quiet rather than a schedule; the cooldown is what stops a dead
 * server turning into an hourly feed.
 */

/** #general must be silent this long before the nudge will post at all. */
export const IDLE_QUIET_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/** Shortest gap between two nudges, however long the silence runs. */
export const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * The `#gallery` post is gated on the same silence, at half the threshold and
 * the same cadence. See the note in `src/channels/gallery.ts` for why it is
 * looser than the nudge in one direction and stricter in the other.
 */
export const GALLERY_QUIET_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const GALLERY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Content kinds tried in one nudge tick before it gives up and waits an hour.
 *
 * Two, not four. A random token id can be a burned bot and an API can be down,
 * so one fallback is worth having; beyond that a tick that finds nothing is
 * better off costing nothing and trying again next hour.
 */
export const NUDGE_KIND_ATTEMPTS = 2;

/** Random token ids the "notable bot" pick will look at. */
export const NUDGE_NOTABLE_SAMPLE = 3;

/** Rank percentile that ends the sample early: top 10% is notable enough. */
export const NUDGE_NOTABLE_PERCENTILE = 10;

/** Artifacts pulled before picking one for a nudge or a gallery post. */
export const RANDOM_ARTIFACT_FETCH_LIMIT = 50;

/**
 * Discord's REST root, pinned to v10.
 *
 * Three callers, and the version has to be the same for all of them: the
 * gateway DO's `/gateway/bot` discovery, the interaction follow-up PATCH, and
 * the operator's command registration. The gateway socket carries `v=10` in
 * its query string for the same reason.
 */
export const DISCORD_API = "https://discord.com/api/v10";

/** GlyphBots brand color for embeds. */
export const GLYPHBOTS_COLOR = 0x00ff88;

/** OpenSea v2 API root (`src/api/opensea.ts:18` at `c75d6a8`). */
export const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";

/** Bot contract (`src/api/opensea.ts:19` at `c75d6a8`). */
export const GLYPHBOTS_CONTRACT = "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075";

/** Artifact contract (`src/commands/artifact.ts:23` at `c75d6a8`). */
export const ARTIFACTS_CONTRACT = "0x3c64dc415de60ee9a25f67fb48e7c9a234a4b6d1";

/** OpenSea collection slug (`src/api/opensea.ts:20` at `c75d6a8`). */
export const GLYPHBOTS_COLLECTION_SLUG = "glyphbots";

/** Chain every OpenSea path is scoped to. */
export const OPENSEA_CHAIN = "ethereum";

/** Highest bot token id, and the denominator on every rarity rank. */
export const MAX_BOT_TOKEN_ID = 11_111;

/**
 * Embed colors, carried over from the Node bot's per-command
 * `HexColorString` constants (`src/commands/*.ts` at `c75d6a8`) so no reply
 * changes color. They are numbers here because `@discordjs/builders`'s
 * `setColor` takes a number or an RGB tuple; the `"#rrggbb"` overload is a
 * discord.js addition.
 */
export const COLORS = {
  activity: 0xe6_7e_22,
  artifact: 0x9b_59_b6,
  bot: 0x00_ff_88,
  /** Shared by every not-found and bad-input reply. */
  error: 0xff_44_44,
  info: 0x58_65_f2,
  listing: 0x34_98_db,
  rarity: 0x9b_59_b6,
  sale: 0x2e_cc_71,
  stats: 0xf5_a6_23,
} as const;
