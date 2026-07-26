/**
 * Inline lookup parsing.
 *
 * Ported from `discord-nft-embed-bot/src/config/collection.ts`: the token
 * regex at `:444-457`, the username regex at `:575-588` and the reserved-word
 * filter at `:593-601`. The Node bot built its regex at runtime from a
 * `COLLECTIONS` env string that could hold any number of collections. Here
 * there are exactly two, both known at compile time, so the prefixes are
 * literals: `b` for GlyphBots, `a` for Artifacts, and a bare `#` means bots.
 *
 * Three deliberate differences from the Node matcher, all of them about
 * spending fewer subrequests per message:
 *
 * 1. **`<#...>` is excluded.** Discord writes a channel mention as
 *    `<#1445933084401864767>`, which the Node regex happily read as a token
 *    lookup for token 1445933084401864767. It never mattered there because the
 *    id failed the range check, but it does matter here: the character before
 *    the `#` is checked so a channel mention, a custom emoji and a role
 *    mention can never enter the matcher at all.
 * 2. **Duplicates collapse.** `b#1 b#1 b#1` is one lookup, not three. The Node
 *    bot built the same embed three times, which is three times the OpenSea
 *    traffic for an identical answer.
 * 3. **The cap applies to the whole message**, across token and username
 *    matches together, rather than six of each. Discord's own limit is six
 *    embeds on a message, so seven was never sendable anyway.
 *
 * This module is pure. Randomness arrives as an injected function so
 * `#random` is testable, and nothing here does any I/O.
 */

import { MAX_ARTIFACT_TOKEN_ID, MAX_BOT_TOKEN_ID } from "../config";

export type LookupMatch =
  | { kind: "bot"; tokenId: number }
  | { kind: "artifact"; tokenId: number }
  | { kind: "username"; username: string };

/**
 * One `#`-trigger. The leading group is the character before the `#`, which
 * exists only so `<` can be rejected; it is not part of the match.
 *
 * The body is captured loosely and classified in code rather than through
 * regex alternation. Alternation backtracks in surprising ways here: `#12ab`
 * against `(\d+|[a-z]\w+)` matches the digits and leaves `ab` dangling, which
 * is how you end up answering a lookup nobody asked for.
 */
const TRIGGER_RE = /(^|[^\w<])([baBA])?#([A-Za-z0-9_?]{1,20})(?![A-Za-z0-9_])/g;

/** `discord-nft-embed-bot/src/config/collection.ts:598`. */
const RANDOM_KEYWORDS = new Set(["random", "rand", "?"]);

/** OpenSea usernames: start with a letter, 3 to 15 characters. */
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,14}$/;

const DIGITS_RE = /^\d+$/;

export type LookupParseOptions = {
  /** Cap on matches returned. Defaults to Discord's six embeds per message. */
  limit?: number;
  /** Injected for tests. Returns an integer in `[1, max]`. */
  randomInt?: (max: number) => number;
};

const defaultRandomInt = (max: number): number =>
  Math.floor(Math.random() * max) + 1;

const keyOf = (match: LookupMatch): string =>
  match.kind === "username"
    ? `username:${match.username.toLowerCase()}`
    : `${match.kind}:${match.tokenId}`;

/** Classify one trigger body against its prefix, or return null for no match. */
const classify = (
  prefix: string,
  body: string,
  randomInt: (max: number) => number
): LookupMatch | null => {
  const kind = prefix.toLowerCase() === "a" ? "artifact" : "bot";
  const max = kind === "artifact" ? MAX_ARTIFACT_TOKEN_ID : MAX_BOT_TOKEN_ID;

  if (RANDOM_KEYWORDS.has(body.toLowerCase())) {
    // `a#random` picks across the artifact id space, which is sparse: the
    // supply is a few dozen, not a few thousand, so most picks would 404.
    // Random artifacts come from the recently-minted list instead, which the
    // gallery cron already does, so `#random` here always means a bot.
    return { kind: "bot", tokenId: randomInt(MAX_BOT_TOKEN_ID) };
  }

  if (DIGITS_RE.test(body)) {
    const tokenId = Number(body);
    if (tokenId < 1 || tokenId > max) {
      return null;
    }
    return { kind, tokenId };
  }

  if (USERNAME_RE.test(body)) {
    return { kind: "username", username: body };
  }

  return null;
};

/**
 * Pull every lookup out of a message body, in order, deduplicated and capped.
 */
export const parseLookups = (
  content: string,
  options: LookupParseOptions = {}
): LookupMatch[] => {
  const limit = options.limit ?? 6;
  const randomInt = options.randomInt ?? defaultRandomInt;

  const matches: LookupMatch[] = [];
  const seen = new Set<string>();

  TRIGGER_RE.lastIndex = 0;
  let found = TRIGGER_RE.exec(content);

  while (found !== null) {
    const prefix = found[2] ?? "";
    const body = found[3] ?? "";
    const match = classify(prefix, body, randomInt);

    if (match) {
      const key = keyOf(match);
      if (!seen.has(key)) {
        seen.add(key);
        matches.push(match);
        if (matches.length >= limit) {
          break;
        }
      }
    }

    // A trigger can end on the character that would start the next one
    // (`b#1 a#2` consumes the space before `a`), so step the cursor back one
    // to keep adjacent triggers matchable.
    TRIGGER_RE.lastIndex = Math.max(TRIGGER_RE.lastIndex - 1, found.index + 1);
    found = TRIGGER_RE.exec(content);
  }

  TRIGGER_RE.lastIndex = 0;
  return matches;
};
