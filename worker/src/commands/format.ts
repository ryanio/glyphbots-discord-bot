/**
 * Display formatting shared by the ported commands.
 *
 * On the Node bot each of `activity.ts`, `bot.ts`, `floor.ts`, `listings.ts`
 * and `sales.ts` carried its own copy of `formatETH`, in two slightly
 * different flavors: one taking a raw on-chain quantity plus decimals, one
 * taking an already-scaled number. Both are here, once, with their original
 * thresholds unchanged so output does not shift.
 */

import { MS_PER_SECOND } from "../utils/time";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_WEEK = 604_800;

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
 * Scaled-value flavor, from the Node bot's `/floor` (`src/commands/floor.ts:17`
 * at `c75d6a8`). Three decimals there were two; the difference is preserved via
 * `digits`.
 */
const formatEthValue = (value: number, digits = PRICE_DIGITS): string => {
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

/** Raw on-chain quantity flavor (`src/commands/sales.ts:22` at `c75d6a8`). */
export const formatEthAmount = (quantity: string, decimals: number): string =>
  formatEthValue(Number(quantity) / 10 ** decimals);

/** Collection stats use two decimals (`src/commands/floor.ts:27` at `c75d6a8`). */
export const formatEthStat = (value: number): string =>
  formatEthValue(value, STAT_DIGITS);

/** `src/commands/floor.ts:30` at `c75d6a8`. */
export const formatNumber = (value: number): string => {
  if (value >= MILLION) {
    return `${(value / MILLION).toFixed(PERCENT_DIGITS)}M`;
  }
  if (value >= THOUSAND) {
    return `${(value / THOUSAND).toFixed(PERCENT_DIGITS)}K`;
  }
  return value.toLocaleString();
};

/**
 * Guard against a stats response that typechecks but carries a hole.
 *
 * The OpenSea types in `../api/types.ts` declare these fields as required
 * numbers, which is what the endpoint documents rather than what it always
 * sends: fields go missing on a partial index and `undefined` sails straight
 * into `toFixed` as a thrown handler.
 */
export const finiteNumber = (
  value: number | null | undefined
): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * The collection floor, but only when OpenSea says it is priced in ETH.
 *
 * `formatEthStat` writes the unit into the string it returns, so quoting a
 * floor denominated in anything else would be a false statement rather than a
 * formatting slip. An absent or empty symbol is read as ETH, which is what the
 * endpoint gives for this collection. Shared by `/floor` and the idle nudge's
 * `collectionFacts`, so the two cannot drift apart on what counts as a
 * quotable floor.
 */
export const ethFloorPrice = (
  total:
    | { floor_price?: number | null; floor_price_symbol?: string | null }
    | null
    | undefined
): number | null => {
  const symbol = total?.floor_price_symbol;
  if (
    symbol !== undefined &&
    symbol !== null &&
    symbol !== "" &&
    symbol !== "ETH"
  ) {
    return null;
  }
  return finiteNumber(total?.floor_price);
};

/** `src/commands/floor.ts:40` at `c75d6a8`. */
export const formatPercentChange = (change: number): string => {
  if (change === 0) {
    return "—";
  }
  const sign = change > 0 ? "+" : "";
  return `${sign}${(change * PERCENT_SCALE).toFixed(PERCENT_DIGITS)}%`;
};

/**
 * `src/commands/activity.ts:29` at `c75d6a8`, the longer of the two copies (it
 * carries the week bucket that `sales.ts` lacked). `now` is injectable so tests
 * are not clock-dependent.
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

/**
 * Bot embed body text, shared by `/bot` and the inline `b#`/`#username`
 * lookups so the two read as one product.
 *
 * The shapes here exist to keep a lookup to a few lines of channel height. A
 * bot embed used to spend a six-line inline field on traits and a six-row code
 * block on stats, which pushed the artwork most of a screen down and left the
 * inline row beside the traits mostly empty. Traits now render on one line and
 * stats in a 3x2 grid.
 */

/** Discord rejects a field value over 1024 characters. */
const FIELD_VALUE_LIMIT = 1024;
/** Headroom under the hard limit, so the ellipsis always fits. */
const TRAIT_LINE_BUDGET = 1000;

const TRAIT_SEPARATOR = " · ";
const ELLIPSIS = "…";

/**
 * Traits that carry no information in an embed that already shows them.
 * `Name` duplicates the description, which is the bot's name.
 */
const SKIPPED_TRAIT_TYPES = new Set(["name"]);
/** Values the API uses for "this bot does not have one". */
const EMPTY_TRAIT_VALUES = new Set(["None", "No"]);

/** Traits worth rendering: no placeholders, no duplicate of the description. */
const displayTraits = <T extends { trait_type: string; value: string }>(
  traits: readonly T[]
): T[] =>
  traits.filter(
    (trait) =>
      !EMPTY_TRAIT_VALUES.has(trait.value) &&
      !SKIPPED_TRAIT_TYPES.has(trait.trait_type.toLowerCase()) &&
      trait.value.trim() !== ""
  );

/**
 * One line: `**Head** ▲▼▲ · **Eyes** ◇◇`.
 *
 * Trait counts vary per bot and the glyph values can be long, so this fills up
 * to a budget well under Discord's per-field limit and marks the cut with an
 * ellipsis rather than emitting a field Discord will reject. Returns `""` when
 * there is nothing to show; callers must omit the field in that case, because
 * an empty field value is also rejected.
 */
export const formatTraitLine = (
  traits: readonly { trait_type: string; value: string }[]
): string => {
  const parts: string[] = [];
  let length = 0;

  for (const trait of displayTraits(traits)) {
    const part = `**${trait.trait_type}** ${trait.value}`;
    const added =
      parts.length === 0 ? part.length : part.length + TRAIT_SEPARATOR.length;
    if (length + added > TRAIT_LINE_BUDGET) {
      parts.push(ELLIPSIS);
      break;
    }
    parts.push(part);
    length += added;
  }

  const line = parts.join(TRAIT_SEPARATOR);
  return line.length > FIELD_VALUE_LIMIT
    ? line.slice(0, FIELD_VALUE_LIMIT)
    : line;
};

const STAT_COLUMNS = 3;
const STAT_LABEL_WIDTH = 3;
const STAT_VALUE_WIDTH = 3;

const STAT_CELLS: Array<[label: string, key: string]> = [
  ["STR", "strength"],
  ["AGI", "agility"],
  ["INT", "intellect"],
  ["LCK", "luck"],
  ["END", "endurance"],
  ["CHA", "charisma"],
];

/**
 * The six story stats as a 3x2 monospace grid, two lines instead of six.
 *
 * The old version drew a ten-segment ASCII bar per stat. At this size the
 * number is what carries the information, and the bars cost four extra lines.
 * The code fence stays because proportional text will not align columns.
 * Returns `""` when there are no stats, so the caller omits the field.
 */
export const formatStatsGrid = (
  stats: Record<string, number> | null | undefined
): string => {
  if (!stats || Object.keys(stats).length === 0) {
    return "";
  }

  const cells = STAT_CELLS.map(([label, key]) => {
    const value = stats[key] ?? 0;
    return `${label.padEnd(STAT_LABEL_WIDTH)} ${String(value).padStart(STAT_VALUE_WIDTH)}`;
  });

  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += STAT_COLUMNS) {
    rows.push(cells.slice(i, i + STAT_COLUMNS).join("  "));
  }

  return `\`\`\`\n${rows.join("\n")}\n\`\`\``;
};

const POWER_LIMIT = 3;

/** `Adaptive Movement · Darkness Field · Overload Strike`, or `""`. */
export const formatPowerLine = (
  powers: readonly string[] | null | undefined
): string => {
  if (!powers || powers.length === 0) {
    return "";
  }
  return powers.slice(0, POWER_LIMIT).join(TRAIT_SEPARATOR);
};

/** Faction over role, so it sits in the top inline row without widening it. */
export const formatRoleValue = (
  faction: string | null | undefined,
  role: string | null | undefined
): string => [faction, role].filter((part) => Boolean(part)).join("\n");
