/**
 * The rarity rank resolver.
 *
 * What matters here is the request count, not the arithmetic: the whole reason
 * this exists rather than a `fetchNFT` per token is that eight sale lines cost
 * one request. Every test below asserts what went out as well as what came
 * back.
 */

import { describe, expect, it, vi } from "vitest";
import { createRarityRanks } from "../src/api/rarity-ranks";
import type { Bot } from "../src/api/types";
import { createBot } from "./fixtures";

/** A batch client over a fixed rank table. Ids not in it come back absent. */
const stubBatch = (ranks: Record<number, number>) => {
  const fetchBots = vi.fn((tokenIds: number[]) =>
    Promise.resolve(
      tokenIds
        .filter((tokenId) => tokenId in ranks)
        .map((tokenId) =>
          createBot(tokenId, { rarityRank: ranks[tokenId] as number })
        )
    )
  );
  return { fetchBots };
};

describe("createRarityRanks", () => {
  it("asks for the whole list once and maps the ranks by token id", async () => {
    const client = stubBatch({ 1: 42, 2: 900 });
    const ranks = await createRarityRanks(client).ranks([1, 2]);

    expect(client.fetchBots).toHaveBeenCalledTimes(1);
    expect(client.fetchBots).toHaveBeenCalledWith([1, 2]);
    expect(ranks.get(1)).toBe(42);
    expect(ranks.get(2)).toBe(900);
  });

  it("asks about each id once, however many times it appears", async () => {
    const client = stubBatch({ 7: 100 });
    const resolver = createRarityRanks(client);

    // A sweep of the same bot, then the same bot again on the next embed.
    await resolver.ranks([7, 7, 7]);
    expect(await resolver.rank(7)).toBe(100);

    expect(client.fetchBots).toHaveBeenCalledTimes(1);
    expect(client.fetchBots).toHaveBeenCalledWith([7]);
  });

  it("asks only for what is not already cached", async () => {
    const client = stubBatch({ 1: 10, 2: 20 });
    const resolver = createRarityRanks(client);

    await resolver.ranks([1]);
    await resolver.ranks([1, 2]);

    expect(client.fetchBots).toHaveBeenNthCalledWith(2, [2]);
  });

  it("does not ask about an id that is not a token id", async () => {
    const client = stubBatch({ 5: 1 });
    // `Number(undefined)` on an event with no nft block, and the zero and
    // negative cases a hand-typed id could produce.
    const ranks = await createRarityRanks(client).ranks([
      Number.NaN,
      0,
      -3,
      1.5,
      5,
    ]);

    expect(client.fetchBots).toHaveBeenCalledWith([5]);
    expect([...ranks.keys()]).toEqual([5]);
  });

  it("says nothing at all for a bot the API does not know", async () => {
    const client = stubBatch({});
    const resolver = createRarityRanks(client);

    expect(await resolver.rank(11_112)).toBeNull();
    // Asked once, then remembered as a miss.
    await resolver.rank(11_112);
    expect(client.fetchBots).toHaveBeenCalledTimes(1);
  });

  it("treats rank zero as no rank", async () => {
    // `percentileOf(0)` clears every threshold in the tier table, so a zero
    // that reached a badge would print as Legendary.
    const client = { fetchBots: vi.fn(() => Promise.resolve([] as Bot[])) };
    client.fetchBots.mockResolvedValueOnce([createBot(3, { rarityRank: 0 })]);

    expect(await createRarityRanks(client).rank(3)).toBeNull();
  });

  it("prints no rank when the request fails", async () => {
    // The client answers `[]` rather than throwing on a failure, which is what
    // makes rarity decoration rather than something that can break a reply.
    const client = { fetchBots: vi.fn(() => Promise.resolve([] as Bot[])) };
    const ranks = await createRarityRanks(client).ranks([1, 2, 3]);

    expect(ranks.size).toBe(0);
  });
});
