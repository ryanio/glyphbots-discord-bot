/**
 * The sales feed across both collections.
 *
 * `sales.test.ts` covers the cursor, exactly-once delivery and grouping, all of
 * it against bot sales. This covers what having a second collection adds: that
 * both slugs are swept, that an artifact renders as an artifact rather than as
 * the bot sharing its number, and that the two never end up in one message.
 */

import { describe, expect, it, vi } from "vitest";
import { ARTIFACTS, BOTS } from "../src/api/collections";
import { pollSales } from "../src/channels/sales";
import { SALES_SETTLE_MS } from "../src/config";
import {
  createArtifact,
  createBot,
  createMemoryPoster,
  firstEmbed,
  stubGlyphBots,
  TEST_ORIGIN,
} from "./fixtures";
import {
  artifactSaleEvent,
  createMemorySalesStore,
  createOpenSea,
  saleEvent,
  salesPollDeps,
  salesState,
} from "./sales-fixtures";

const T0 = 1_760_000_000;
const LATER = (T0 + 3600) * 1000;

const field = (
  embed: { fields?: { name: string; value: string }[] },
  name: string
): string | undefined => embed.fields?.find((f) => f.name === name)?.value;

/**
 * A GlyphBots client that knows one artifact and one rank table.
 *
 * The rank table is keyed by bot token id, exactly as `/api/bots` is, which is
 * what makes the "does not print a bot's rank on an artifact" case meaningful:
 * the artifact and the bot deliberately share a number.
 */
const glyphbotsWith = (artifact = createArtifact({ contractTokenId: 180 })) =>
  stubGlyphBots({
    fetchArtifact: vi.fn((tokenId: number) =>
      Promise.resolve(tokenId === artifact.contractTokenId ? artifact : null)
    ),
    fetchBots: vi.fn((tokenIds: number[]) =>
      Promise.resolve(
        tokenIds.map((tokenId) => createBot(tokenId, { rarityRank: 42 }))
      )
    ),
  });

describe("sweeping both collections", () => {
  it("asks OpenSea for each collection by slug", async () => {
    const opensea = createOpenSea([[]]);

    await pollSales(
      salesPollDeps(
        opensea,
        createMemoryPoster(),
        createMemorySalesStore(salesState(T0)),
        () => LATER
      )
    );

    const slugs = opensea.fetchCollectionEventsSince.mock.calls.map(
      ([options]) => options?.slug
    );
    expect(slugs).toEqual([BOTS.slug, ARTIFACTS.slug]);
  });

  it("seeds the cursor from the newest event in either collection", async () => {
    const store = createMemorySalesStore(null);

    await pollSales(
      salesPollDeps(
        createOpenSea([[saleEvent({ event_timestamp: T0 })]], {
          artifactPages: [[artifactSaleEvent({ event_timestamp: T0 + 500 })]],
        }),
        createMemoryPoster(),
        store,
        () => LATER
      )
    );

    expect(store.current?.lastEventTimestamp).toBe(T0 + 500);
  });

  it("posts both collections in the order the sales happened", async () => {
    const poster = createMemoryPoster();

    await pollSales(
      salesPollDeps(
        createOpenSea([[saleEvent({ event_timestamp: T0 + 20 })]], {
          artifactPages: [[artifactSaleEvent({ event_timestamp: T0 + 10 })]],
        }),
        poster,
        createMemorySalesStore(salesState(T0)),
        () => LATER,
        glyphbotsWith()
      )
    );

    // The artifact sold first, so it goes out first even though the bots are
    // swept first.
    expect(poster.sends.map((send) => firstEmbed(send).title)).toEqual([
      "Purchased: Artifact 180 #180",
      "Purchased: GlyphBot #1",
    ]);
  });
});

describe("artifact embeds", () => {
  const postOne = async (
    event = artifactSaleEvent({ event_timestamp: T0 + 10 }),
    artifact = createArtifact({ contractTokenId: 180 })
  ) => {
    const poster = createMemoryPoster();
    await pollSales(
      salesPollDeps(
        createOpenSea([[]], { artifactPages: [[event]] }),
        poster,
        createMemorySalesStore(salesState(T0)),
        () => LATER,
        glyphbotsWith(artifact)
      )
    );
    return firstEmbed(poster.sends[0]);
  };

  it("titles the sale from the artifact's own title", async () => {
    // The event carries `name: ""`, which is what the live endpoint sends for
    // these tokens, so the title has to come from the GlyphBots API.
    expect((await postOne()).title).toBe("Purchased: Artifact 180 #180");
  });

  it("falls back to the collection noun when nothing has a title", async () => {
    const embed = await postOne(
      artifactSaleEvent({
        event_timestamp: T0 + 10,
        nft: {
          identifier: "9",
          name: "",
          collection: ARTIFACTS.slug,
          contract: ARTIFACTS.contract,
        },
      }),
      createArtifact({ contractTokenId: 9, title: null })
    );
    expect(embed.title).toBe("Purchased: Artifact #9");
  });

  it("links the artifacts contract, not the bots one", async () => {
    const embed = await postOne();
    expect(embed.url).toBe(
      `https://opensea.io/assets/ethereum/${ARTIFACTS.contract}/180`
    );
  });

  it("shows the artifact's own image", async () => {
    const embed = await postOne();
    expect(embed.image?.url).toBe(`${TEST_ORIGIN}/artifacts/180.jpg`);
  });

  it("links the artifact page and the bot it came from", async () => {
    const embed = await postOne();
    expect(field(embed, "Artifact")).toBe(
      `[View](${TEST_ORIGIN}/artifact/180)`
    );
    // `createArtifact` sets botTokenId 7.
    expect(field(embed, "Bot")).toBe(`[#7](${TEST_ORIGIN}/bot/7)`);
  });

  it("prints no rarity, even when a bot shares the number", async () => {
    // The stub ranks every id it is asked about, so a Rarity field here would
    // mean the artifact had been looked up in the bots' rank table.
    expect(field(await postOne(), "Rarity")).toBeUndefined();
  });

  it("names the quantity on a multi-copy 1155 sale", async () => {
    const embed = await postOne(
      artifactSaleEvent({ event_timestamp: T0 + 10, quantity: 3 })
    );
    expect(field(embed, "Quantity")).toBe("×3");
  });

  it("leaves quantity off a single sale", async () => {
    expect(field(await postOne(), "Quantity")).toBeUndefined();
  });

  it("still renders a bot sale as a bot", async () => {
    const poster = createMemoryPoster();
    await pollSales(
      salesPollDeps(
        createOpenSea([[saleEvent({ event_timestamp: T0 + 10 })]]),
        poster,
        createMemorySalesStore(salesState(T0)),
        () => LATER,
        glyphbotsWith()
      )
    );

    const embed = firstEmbed(poster.sends[0]);
    expect(embed.title).toBe("Purchased: GlyphBot #1");
    expect(embed.image?.url).toBe(`${TEST_ORIGIN}/bots/pngs/1.png`);
    expect(field(embed, "Rarity")).toContain("#42");
    expect(field(embed, "GlyphBot")).toBe(`[View](${TEST_ORIGIN}/bot/1)`);
  });
});

describe("titles that already carry their token id", () => {
  const titleOf = async (name: string, identifier: string) => {
    const poster = createMemoryPoster();
    await pollSales(
      salesPollDeps(
        createOpenSea([
          [
            saleEvent({
              event_timestamp: T0 + 10,
              nft: {
                identifier,
                name,
                collection: BOTS.slug,
                contract: BOTS.contract,
              },
            }),
          ],
        ]),
        poster,
        createMemorySalesStore(salesState(T0)),
        () => LATER,
        glyphbotsWith()
      )
    );
    return firstEmbed(poster.sends[0]).title;
  };

  it("does not repeat an id the name already has", async () => {
    // The shape OpenSea actually names these tokens in.
    expect(await titleOf("GlyphBot #3101 - Jumpynexus", "3101")).toBe(
      "Purchased: GlyphBot #3101 - Jumpynexus"
    );
  });

  it("appends the id when the name carries a different one", async () => {
    expect(await titleOf("Artifact of GlyphBot #31", "3101")).toBe(
      "Purchased: Artifact of GlyphBot #31 #3101"
    );
  });
});

describe("groups stay within one collection", () => {
  /** A sweep of `count` artifacts by one buyer, one transaction each. */
  const artifactSweep = (count: number, timestamp: number) =>
    Array.from({ length: count }, (_, index) =>
      artifactSaleEvent({
        event_timestamp: timestamp + index,
        transaction: `0xartifact${index}`,
        nft: {
          identifier: String(180 + index),
          name: "",
          collection: ARTIFACTS.slug,
          contract: ARTIFACTS.contract,
        },
      })
    );

  it("does not merge one buyer's bots and artifacts into one message", async () => {
    const bots = [
      saleEvent({ event_timestamp: T0 + 10, transaction: "0xbot1" }),
      saleEvent({ event_timestamp: T0 + 11, transaction: "0xbot2" }),
    ];
    const opensea = createOpenSea([bots, []], {
      artifactPages: [artifactSweep(2, T0 + 12), []],
    });
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));
    const firstTick = (T0 + 20) * 1000;

    await pollSales(
      salesPollDeps(opensea, poster, store, () => firstTick, glyphbotsWith())
    );
    expect(poster.sends).toHaveLength(0);

    await pollSales(
      salesPollDeps(
        opensea,
        poster,
        store,
        () => firstTick + SALES_SETTLE_MS + 1000,
        glyphbotsWith()
      )
    );

    expect(poster.sends.map((send) => firstEmbed(send).title).sort()).toEqual([
      "2 GlyphBots purchased",
      "2 artifacts purchased",
    ]);
  });

  it("points an artifact group at the artifacts collection", async () => {
    const opensea = createOpenSea([[], []], {
      artifactPages: [artifactSweep(3, T0 + 10), []],
    });
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));
    const firstTick = (T0 + 20) * 1000;

    await pollSales(
      salesPollDeps(opensea, poster, store, () => firstTick, glyphbotsWith())
    );
    await pollSales(
      salesPollDeps(
        opensea,
        poster,
        store,
        () => firstTick + SALES_SETTLE_MS + 1000,
        glyphbotsWith()
      )
    );

    const embed = firstEmbed(poster.sends[0]);
    expect(embed.title).toBe("3 artifacts purchased");
    expect(embed.url).toBe(`https://opensea.io/collection/${ARTIFACTS.slug}`);
    // The thumbnail is the priciest item's art, which for an artifact is the
    // first-party image rather than a bot PNG.
    expect(embed.thumbnail?.url).toBe(`${TEST_ORIGIN}/artifacts/180.jpg`);
  });
});
