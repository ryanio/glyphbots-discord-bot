/**
 * Rarity ranks for a list of bots, one request for the whole list.
 *
 * This exists so a price can be read next to what was bought. A sale line that
 * says 0.42 ETH says nothing about whether that was a good price; the same line
 * with "Rank #421 (Epic)" on it does. `/sales`, `/activity` and the
 * #trading-floor feed all print ranks through here.
 *
 * ## Why the rank comes from GlyphBots and not from OpenSea
 *
 * OpenSea carries a rank too, on `nft.rarity.rank`, and `/rarity`, `/bot` and
 * the inline `b#123` lookup all read it. Those are one token per reply, so one
 * `fetchNFT` covers them. A sales list is not: eight lines is eight tokens, and
 * eight `fetchNFT` calls is eight subrequests against a shared budget plus
 * eight hits on a rate limit this Worker does not control.
 *
 * `POST /api/bots` takes the whole list and answers in one request, first
 * party, with no rate limit worth planning around. That is the entire reason.
 *
 * The two sources do not agree exactly. Sampled live on 2026-08-02, OpenSea's
 * OpenRarity rank and the site's stored rank sat within one to three percent of
 * supply of each other (token 42: 791 against 845, token 2500: 4,917 against
 * 5,131). The tier the number lands in was the same for every token sampled,
 * which is the part these lines are really reporting, but the printed number
 * can differ by a couple of hundred places from what `/rarity` says for the
 * same bot. That is a known and accepted difference, not a bug to chase.
 *
 * ## Lifetime
 *
 * One resolver per command invocation or per cron tick, exactly like
 * `./display-name.ts`, and for the same reason: a Worker isolate does not live
 * long enough for a process-lifetime cache to pay off, and one reply is a
 * handful of tokens. A miss is cached as a miss, so a burned or unknown token
 * is not looked up twice inside one reply.
 */

import type { GlyphBotsClient } from "./glyphbots";

export type RarityRanks = {
  /**
   * Ranks for these ids. Whatever is not already cached goes out as one
   * request; ids with no rank are simply absent from the map.
   */
  ranks: (tokenIds: number[]) => Promise<Map<number, number>>;
  /** One id, through the same cache. `null` when there is no rank for it. */
  rank: (tokenId: number) => Promise<number | null>;
};

/** Ids worth asking about: whole numbers above zero, each one once. */
const askable = (tokenIds: number[]): number[] => [
  ...new Set(tokenIds.filter((id) => Number.isInteger(id) && id > 0)),
];

export const createRarityRanks = (
  glyphbots: Pick<GlyphBotsClient, "fetchBots">
): RarityRanks => {
  /** `null` means "asked, no rank", which is cached so it is asked once. */
  const cache = new Map<number, number | null>();

  const ranks = async (tokenIds: number[]): Promise<Map<number, number>> => {
    const wanted = askable(tokenIds);
    const missing = wanted.filter((id) => !cache.has(id));

    if (missing.length > 0) {
      const bots = await glyphbots.fetchBots(missing);
      const found = new Map(bots.map((bot) => [bot.tokenId, bot.rarityRank]));

      for (const id of missing) {
        // No rank means no rank, never rank zero. `percentileOf(0)` clears
        // every threshold in the tier table, so a zero would print as
        // "Legendary" for a bot nobody has ranked. `../commands/rarity.ts`
        // refuses it the same way.
        const rank = found.get(id);
        cache.set(id, typeof rank === "number" && rank > 0 ? rank : null);
      }
    }

    const answer = new Map<number, number>();
    for (const id of wanted) {
      const rank = cache.get(id);
      if (rank !== null && rank !== undefined) {
        answer.set(id, rank);
      }
    }
    return answer;
  };

  return {
    ranks,
    rank: async (tokenId) => (await ranks([tokenId])).get(tokenId) ?? null,
  };
};
