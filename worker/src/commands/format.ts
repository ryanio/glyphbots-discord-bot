/**
 * Display formatting shared by the ported commands.
 *
 * On the Node bot each of `activity.ts`, `bot.ts`, `floor.ts`, `listings.ts`
 * and `sales.ts` carried its own copy of `formatETH`, in two slightly
 * different flavors: one taking a raw on-chain quantity plus decimals, one
 * taking an already-scaled number. Both are here, once, with their original
 * thresholds unchanged so output does not shift.
 */

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_WEEK = 604_800;
const MS_PER_SECOND = 1000;

const TINY = 0.0001;
const THOUSAND = 1000;
const MILLION = 1_000_000;

const EXP_DIGITS = 2;
const SMALL_DIGITS = 4;
const PRICE_DIGITS = 3;
const STAT_DIGITS = 2;
const PERCENT_DIGITS = 1;
const PERCENT_SCALE = 100;

/**
 * Scaled-value flavor, from `src/commands/floor.ts:17`. Three decimals there
 * were two; the difference is preserved via `digits`.
 */
export const formatEthValue = (value: number, digits = PRICE_DIGITS): string => {
  if (value === 0) {
    return "0 ETH";
  }
  if (value < TINY) {
    return `${value.toExponential(EXP_DIGITS)} ETH`;
  }
  if (value < 1) {
    return `${value.toFixed(SMALL_DIGITS)} ETH`;
  }
  return `${value.toFixed(digits)} ETH`;
};

/** Raw on-chain quantity flavor, from `src/commands/sales.ts:22`. */
export const formatEthAmount = (quantity: string, decimals: number): string =>
  formatEthValue(Number(quantity) / 10 ** decimals);

/** Collection stats use two decimals (`src/commands/floor.ts:27`). */
export const formatEthStat = (value: number): string =>
  formatEthValue(value, STAT_DIGITS);

/** `src/commands/floor.ts:30` */
export const formatNumber = (value: number): string => {
  if (value >= MILLION) {
    return `${(value / MILLION).toFixed(PERCENT_DIGITS)}M`;
  }
  if (value >= THOUSAND) {
    return `${(value / THOUSAND).toFixed(PERCENT_DIGITS)}K`;
  }
  return value.toLocaleString();
};

/** `src/commands/floor.ts:40` */
export const formatPercentChange = (change: number): string => {
  if (change === 0) {
    return "—";
  }
  const sign = change > 0 ? "+" : "";
  return `${sign}${(change * PERCENT_SCALE).toFixed(PERCENT_DIGITS)}%`;
};

/**
 * `src/commands/activity.ts:29`, the longer of the two copies (it carries the
 * week bucket that `sales.ts` lacked). `now` is injectable so tests are not
 * clock-dependent.
 */
export const formatTimeAgo = (timestamp: number, now = Date.now()): string => {
  const seconds = Math.floor(now / MS_PER_SECOND - timestamp);
  if (seconds < SECONDS_PER_MINUTE) {
    return "just now";
  }
  if (seconds < SECONDS_PER_HOUR) {
    return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ago`;
  }
  if (seconds < SECONDS_PER_DAY) {
    return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ago`;
  }
  if (seconds < SECONDS_PER_WEEK) {
    return `${Math.floor(seconds / SECONDS_PER_DAY)}d ago`;
  }
  return `${Math.floor(seconds / SECONDS_PER_WEEK)}w ago`;
};

/** Strip the `GlyphBot #123 - ` prefix off an API bot name. */
export const BOT_NAME_PREFIX = /^GlyphBot #\d+ - /;
