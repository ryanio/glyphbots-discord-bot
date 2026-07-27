/**
 * The OpenSea sales feed.
 *
 * The Node bot had no equivalent suite that could run here: its tests drive a
 * discord.js client and a `.state/` JSON file. These cover the four things the
 * port had to get right, which are the four things a lost cursor or a dead
 * process would break: seeding, exactly-once posting, the retry hold-back, and
 * grouping surviving an invocation boundary.
 */

import { describe, expect, it } from "vitest";
import type { SalesFeedState } from "../src/channels/sales";
import {
  advanceSalesCursor,
  applySalesUpdate,
  emptySalesState,
  pollSales,
} from "../src/channels/sales";
import { SALES_MAX_MESSAGES_PER_TICK, SALES_SETTLE_MS } from "../src/config";
import { createFeedStateDO, createMemoryPoster, firstEmbed } from "./fixtures";
import {
  createMemorySalesStore,
  createOpenSea,
  createSweepStub,
  saleEvent,
  salesPollDeps,
  salesState,
  sweep,
} from "./sales-fixtures";

const T0 = 1_760_000_000;
/** Wall clock far enough past the events that any settle window has elapsed. */
const LATER = (T0 + 3600) * 1000;

describe("cold start", () => {
  it("seeds the cursor from the newest event and posts nothing", async () => {
    const opensea = createOpenSea([[saleEvent({ event_timestamp: T0 })]]);
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(null);

    const sent = await pollSales(
      salesPollDeps(opensea, poster, store, () => LATER)
    );

    expect(sent).toBe(0);
    expect(poster.sends).toHaveLength(0);
    expect(store.current?.lastEventTimestamp).toBe(T0);
    expect(store.current?.grouping.processedKeys).toEqual([]);
  });

  it("falls back to the wall clock when the collection has no events", async () => {
    const store = createMemorySalesStore(null);

    await pollSales(
      salesPollDeps(
        createOpenSea([[]]),
        createMemoryPoster(),
        store,
        () => LATER
      )
    );

    expect(store.current?.lastEventTimestamp).toBe(Math.floor(LATER / 1000));
  });

  it("does not replay the backlog on the tick after seeding", async () => {
    const old = saleEvent({
      event_timestamp: T0 - 200,
      transaction: "0xold",
      nft: { identifier: "111", name: "GlyphBot" },
    });
    const seedEvent = saleEvent({
      event_timestamp: T0,
      transaction: "0xseed",
      nft: { identifier: "222", name: "GlyphBot" },
    });
    // The seed probe sees the newest event. Every later tick is handed the
    // whole history and the stub applies the `after` the feed asked for, which
    // is what the real endpoint does.
    const opensea = createOpenSea([[seedEvent], [old, seedEvent]]);
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(null);

    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));
    expect(poster.sends).toHaveLength(0);

    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));

    // The lag window reaches 120 seconds behind the seeded cursor, so the
    // seeding event itself comes back and posts. The one 200 seconds behind it
    // is outside that window and is never seen at all.
    expect(poster.sends).toHaveLength(1);
    expect(firstEmbed(poster.sends[0]).title).toContain("#222");

    // A third tick with the same payload adds nothing: the key set rejects it.
    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));
    expect(poster.sends).toHaveLength(1);
    expect(store.current?.lastEventTimestamp).toBe(T0);
  });
});

describe("a new sale", () => {
  it("posts exactly once", async () => {
    const event = saleEvent({ event_timestamp: T0 + 10 });
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));

    const sent = await pollSales(
      salesPollDeps(createOpenSea([[event]]), poster, store, () => LATER)
    );

    expect(sent).toBe(1);
    expect(poster.sends).toHaveLength(1);
    expect(firstEmbed(poster.sends[0]).title).toContain("Purchased");
    expect(store.current?.lastEventTimestamp).toBe(T0 + 10);
  });

  it("uses the first-party PNG rather than an OpenSea image", async () => {
    const event = saleEvent({
      event_timestamp: T0 + 10,
      nft: { identifier: "77", name: "GlyphBot" },
    });
    const poster = createMemoryPoster();

    await pollSales(
      salesPollDeps(
        createOpenSea([[event]]),
        poster,
        createMemorySalesStore(salesState(T0)),
        () => LATER
      )
    );

    expect(firstEmbed(poster.sends[0]).image?.url).toBe(
      "https://www.glyphbots.com/bots/pngs/77.png"
    );
  });

  it("prices the sale from the payment", async () => {
    const poster = createMemoryPoster();
    const event = saleEvent({
      event_timestamp: T0 + 10,
      payment: {
        quantity: "1500000000000000000",
        token_address: "0x0",
        decimals: 18,
        symbol: "WETH",
      },
    });

    await pollSales(
      salesPollDeps(
        createOpenSea([[event]]),
        poster,
        createMemorySalesStore(salesState(T0)),
        () => LATER
      )
    );

    const fields = firstEmbed(poster.sends[0]).fields ?? [];
    expect(fields.find((f) => f.name === "Price")?.value).toBe("1.5 ETH");
  });

  it("does not repost on a repeat tick with the same payload", async () => {
    const event = saleEvent({ event_timestamp: T0 + 10 });
    const opensea = createOpenSea([[event]]);
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));

    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));
    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));
    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));

    expect(poster.sends).toHaveLength(1);
  });

  it("ignores event types the feed is not configured for", async () => {
    const listing = saleEvent({
      event_timestamp: T0 + 10,
      event_type: "order",
      order_type: "listing",
      maker: "0x3333333333333333333333333333333333333333",
      order_hash: "0xhash",
      transaction: undefined,
    });
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));

    await pollSales(
      salesPollDeps(createOpenSea([[listing]]), poster, store, () => LATER)
    );

    expect(poster.sends).toHaveLength(0);
  });
});

describe("send failure", () => {
  it("holds the cursor back so the sale is retried next tick", async () => {
    const event = saleEvent({ event_timestamp: T0 + 10 });
    const poster = createMemoryPoster();
    poster.send.mockRejectedValue(new Error("discord 500"));
    const store = createMemorySalesStore(salesState(T0));

    const sent = await pollSales(
      salesPollDeps(createOpenSea([[event]]), poster, store, () => LATER)
    );

    expect(sent).toBe(0);
    expect(store.current?.lastEventTimestamp).toBeLessThanOrEqual(T0 + 10);
    expect(store.current?.deferred).toHaveLength(1);
  });

  it("delivers the held message on the next tick without duplicating it", async () => {
    const event = saleEvent({ event_timestamp: T0 + 10 });
    const opensea = createOpenSea([[event]]);
    const poster = createMemoryPoster();
    poster.send.mockRejectedValueOnce(new Error("discord 500"));
    const store = createMemorySalesStore(salesState(T0));

    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));
    const sent = await pollSales(
      salesPollDeps(opensea, poster, store, () => LATER)
    );

    expect(sent).toBe(1);
    // Two attempts, one delivery, no second copy built from the re-fetch.
    expect(poster.send).toHaveBeenCalledTimes(2);
    expect(store.current?.deferred).toHaveLength(0);
    expect(store.current?.lastEventTimestamp).toBe(T0 + 10);
  });

  it("does not advance the cursor when the fetch itself failed", async () => {
    const store = createMemorySalesStore(salesState(T0));
    const opensea = createSweepStub({
      events: [saleEvent({ event_timestamp: T0 + 10 })],
      failed: true,
    });

    await pollSales(
      salesPollDeps(opensea, createMemoryPoster(), store, () => LATER)
    );

    expect(store.current?.lastEventTimestamp).toBe(T0);
  });
});

describe("an event the embed builders reject", () => {
  /**
   * `itemLabel` feeds `nft.name` into `setTitle` and `itemUrl` feeds
   * `nft.opensea_url` into `setURL`, and both validate through
   * `@sapphire/shapeshift` at call time. A name over 256 characters and a
   * non-absolute URL are the two shapes that reach production; either one used
   * to throw out of `buildMessages` and take the whole tick with it.
   */
  const poison = (timestamp: number) =>
    saleEvent({
      event_timestamp: timestamp,
      transaction: `0xpoison${timestamp}`,
      buyer: "0x9999999999999999999999999999999999999999",
      nft: { identifier: "not-a-number", name: "x".repeat(400) },
    });

  it("does not throw out of the tick", async () => {
    const store = createMemorySalesStore(salesState(T0));

    await expect(
      pollSales(
        salesPollDeps(
          createOpenSea([[poison(T0 + 10)]]),
          createMemoryPoster(),
          store,
          () => LATER
        )
      )
    ).resolves.toBe(0);
  });

  it("still posts the good events in the same batch", async () => {
    const good = saleEvent({
      event_timestamp: T0 + 20,
      transaction: "0xgood",
      buyer: "0x1111111111111111111111111111111111111111",
      nft: { identifier: "42", name: "GlyphBot" },
    });
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));

    const sent = await pollSales(
      salesPollDeps(
        createOpenSea([[poison(T0 + 10), good]]),
        poster,
        store,
        () => LATER
      )
    );

    expect(sent).toBe(1);
    expect(firstEmbed(poster.sends[0]).title).toContain("#42");
  });

  it("advances the cursor rather than stalling on it", async () => {
    const store = createMemorySalesStore(salesState(T0));

    await pollSales(
      salesPollDeps(
        createOpenSea([[poison(T0 + 10)]]),
        createMemoryPoster(),
        store,
        () => LATER
      )
    );

    expect(store.current?.lastEventTimestamp).toBe(T0 + 10);
    expect(store.current?.deferred).toHaveLength(0);
    // Marked processed, so the same unbuildable event is not retried on every
    // tick for as long as the lag window keeps re-serving it.
    expect(store.current?.grouping.processedKeys).toHaveLength(1);
  });
});

describe("a truncated sweep", () => {
  const backlog = (count: number, from: number) =>
    Array.from({ length: count }, (_, index) =>
      saleEvent({
        event_timestamp: from + index,
        buyer: `0x${String(index).repeat(40).slice(0, 40)}`,
        transaction: `0xback${index}`,
        nft: { identifier: String(300 + index), name: "GlyphBot" },
      })
    );

  it("does not advance past the events it never fetched", async () => {
    // OpenSea serves newest first, so a sweep that runs out of pages drops the
    // oldest events in the window. Advancing to the newest one it did see
    // steps over every one of them without a word.
    const fetched = backlog(4, T0 + 100);
    const store = createMemorySalesStore(salesState(T0));

    await pollSales(
      salesPollDeps(
        createSweepStub({ events: fetched, pages: 10, truncated: true }),
        createMemoryPoster(),
        store,
        () => LATER
      )
    );

    expect(store.current?.lastEventTimestamp).toBe(T0 + 100);
  });

  it("advances to the newest when it did not, so the cursor cannot livelock", async () => {
    // Second tick, same window: the sweep truncates in the same place and
    // computes the same oldest, so holding the cursor there would pin it
    // forever and burn ten pages a tick re-reading posted events. It gives the
    // unreachable tail up instead, loudly.
    const fetched = backlog(4, T0 + 100);
    const store = createMemorySalesStore(salesState(T0 + 100));

    await pollSales(
      salesPollDeps(
        createSweepStub({ events: fetched, pages: 10, truncated: true }),
        createMemoryPoster(),
        store,
        () => LATER
      )
    );

    expect(store.current?.lastEventTimestamp).toBe(T0 + 103);
  });

  it("advances to the newest when the sweep completed", async () => {
    const fetched = backlog(4, T0 + 100);
    const store = createMemorySalesStore(salesState(T0));

    await pollSales(
      salesPollDeps(
        createSweepStub({ events: fetched, pages: 10, truncated: false }),
        createMemoryPoster(),
        store,
        () => LATER
      )
    );

    expect(store.current?.lastEventTimestamp).toBe(T0 + 103);
  });
});

describe("advanceSalesCursor", () => {
  const at = (timestamp: number) => saleEvent({ event_timestamp: timestamp });

  it("leaves the cursor alone when nothing arrived", () => {
    expect(advanceSalesCursor(500, [], false)).toEqual({
      at: 500,
      abandonedBelow: null,
    });
    expect(advanceSalesCursor(500, [], true)).toEqual({
      at: 500,
      abandonedBelow: null,
    });
  });

  it("never moves backwards", () => {
    expect(advanceSalesCursor(900, [at(500), at(600)], false).at).toBe(900);
  });

  it("names the events it gave up on", () => {
    expect(advanceSalesCursor(600, [at(500), at(700)], true)).toEqual({
      at: 700,
      abandonedBelow: 500,
    });
  });
});

describe("grouping", () => {
  it("collapses a multi-item sweep into one message", async () => {
    const events = sweep(6, T0 + 10);
    const opensea = createOpenSea([events, []]);
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));
    const firstTick = (T0 + 20) * 1000;

    // Tick one ingests the sweep. The group is not settled yet, and its members
    // are held back rather than posted individually.
    await pollSales(salesPollDeps(opensea, poster, store, () => firstTick));
    expect(poster.sends).toHaveLength(0);

    // Tick two, past the settle window, flushes it as one message.
    await pollSales(
      salesPollDeps(
        opensea,
        poster,
        store,
        () => firstTick + SALES_SETTLE_MS + 1000
      )
    );

    expect(poster.sends).toHaveLength(1);
    const embed = firstEmbed(poster.sends[0]);
    expect(embed.title).toBe("6 items purchased");
    expect(embed.fields?.find((f) => f.name === "Total Spent")?.value).toBe(
      "6 ETH"
    );
  });

  it("survives a restart mid-window through DO storage", async () => {
    const events = sweep(4, T0 + 10);
    const store = createMemorySalesStore(salesState(T0));
    const firstTick = (T0 + 20) * 1000;

    // Tick one: a fresh set of deps, as a cron invocation always is.
    await pollSales(
      salesPollDeps(
        createOpenSea([events]),
        createMemoryPoster(),
        store,
        () => firstTick
      )
    );

    // The pending group is in storage, not in a closure somewhere.
    const persisted = store.current;
    expect(Object.keys(persisted?.grouping.actorGroups ?? {})).toHaveLength(1);

    // The isolate dies here. Tick two is entirely new deps reading that state,
    // and OpenSea has nothing new to say. The flush still happens.
    const poster = createMemoryPoster();
    await pollSales(
      salesPollDeps(
        createOpenSea([[]]),
        poster,
        store,
        () => firstTick + SALES_SETTLE_MS + 1000
      )
    );

    expect(poster.sends).toHaveLength(1);
    expect(firstEmbed(poster.sends[0]).title).toBe("4 items purchased");
    expect(store.current?.grouping.actorGroups).toEqual({});
  });

  it("posts a lone sale immediately rather than waiting for a group", async () => {
    const poster = createMemoryPoster();

    await pollSales(
      salesPollDeps(
        createOpenSea([[saleEvent({ event_timestamp: T0 + 10 })]]),
        poster,
        createMemorySalesStore(salesState(T0)),
        () => LATER
      )
    );

    expect(poster.sends).toHaveLength(1);
    expect(firstEmbed(poster.sends[0]).title).toContain("Purchased");
  });

  it("keeps two buyers in the same tick apart", async () => {
    const events = [
      ...sweep(3, T0 + 10, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      ...sweep(3, T0 + 20, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    ];
    const store = createMemorySalesStore(salesState(T0));
    const firstTick = (T0 + 30) * 1000;

    await pollSales(
      salesPollDeps(
        createOpenSea([events]),
        createMemoryPoster(),
        store,
        () => firstTick
      )
    );

    expect(Object.keys(store.current?.grouping.actorGroups ?? {})).toHaveLength(
      2
    );

    const poster = createMemoryPoster();
    await pollSales(
      salesPollDeps(
        createOpenSea([[]]),
        poster,
        store,
        () => firstTick + SALES_SETTLE_MS + 1000
      )
    );

    expect(poster.sends).toHaveLength(2);
  });
});

describe("per-tick message cap", () => {
  /** Distinct buyers, so each sale is its own message rather than a group. */
  const manySales = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      saleEvent({
        event_timestamp: T0 + 10 + index,
        buyer: `0x${String(index).repeat(40).slice(0, 40)}`,
        transaction: `0xmany${index}`,
        nft: { identifier: String(200 + index), name: "GlyphBot" },
      })
    );

  it("defers the overflow rather than dropping it", async () => {
    const events = manySales(SALES_MAX_MESSAGES_PER_TICK + 3);
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));

    const sent = await pollSales(
      salesPollDeps(createOpenSea([events, []]), poster, store, () => LATER)
    );

    expect(sent).toBe(SALES_MAX_MESSAGES_PER_TICK);
    expect(store.current?.deferred).toHaveLength(3);
  });

  it("drains the deferred queue on later ticks, in order, exactly once", async () => {
    const total = SALES_MAX_MESSAGES_PER_TICK + 3;
    const events = manySales(total);
    const opensea = createOpenSea([events, [], []]);
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));

    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));
    await pollSales(salesPollDeps(opensea, poster, store, () => LATER));

    expect(poster.sends).toHaveLength(total);
    expect(store.current?.deferred).toHaveLength(0);

    const titles = poster.sends.map((body) => firstEmbed(body).title);
    expect(new Set(titles).size).toBe(total);
    expect(titles[0]).toContain("#200");
    expect(titles.at(-1)).toContain(`#${200 + total - 1}`);
  });

  it("holds the cursor behind the deferred overflow", async () => {
    const events = manySales(SALES_MAX_MESSAGES_PER_TICK + 3);
    const store = createMemorySalesStore(salesState(T0));

    await pollSales(
      salesPollDeps(
        createOpenSea([events]),
        createMemoryPoster(),
        store,
        () => LATER
      )
    );

    const oldestDeferred = store.current?.deferred[0]?.oldestTimestamp;
    expect(store.current?.lastEventTimestamp).toBe(oldestDeferred);
  });
});

describe("applySalesUpdate", () => {
  const commit = (
    overrides: Partial<
      Extract<Parameters<typeof applySalesUpdate>[1], { op: "commit" }>
    > = {}
  ) => ({
    op: "commit" as const,
    processedKeys: [],
    actorGroups: {},
    deferred: [],
    advanceTo: null,
    ...overrides,
  });

  it("refuses to re-seed a record that already exists", () => {
    const existing = salesState(T0);
    expect(applySalesUpdate(existing, { op: "seed", at: T0 - 500 })).toEqual(
      existing
    );
  });

  it("seeds an absent record", () => {
    expect(applySalesUpdate(null, { op: "seed", at: T0 })).toEqual(
      emptySalesState(T0)
    );
  });

  it("unions the processed keys rather than replacing them", () => {
    // The one merge that has to be a merge. A tick that overlapped this one has
    // already posted the sale behind its key, and dropping it would let the lag
    // window re-serve the event and post it a second time.
    const current = salesState(T0, {
      grouping: { actorGroups: {}, processedKeys: ["from-the-other-tick"] },
    });

    const next = applySalesUpdate(current, commit({ processedKeys: ["mine"] }));

    expect(next.grouping.processedKeys).toEqual([
      "from-the-other-tick",
      "mine",
    ]);
  });

  it("never moves the cursor backwards", () => {
    // `advanceTo` was computed against the record as this tick read it, which
    // may be behind the record as it now stands.
    const next = applySalesUpdate(
      salesState(T0 + 100),
      commit({ advanceTo: T0 })
    );

    expect(next.lastEventTimestamp).toBe(T0 + 100);
  });

  it("leaves the cursor alone when the sweep failed", () => {
    expect(
      applySalesUpdate(salesState(T0), commit({ advanceTo: null }))
        .lastEventTimestamp
    ).toBe(T0);
  });

  it("holds the cursor back below the oldest undelivered message", () => {
    const next = applySalesUpdate(
      salesState(T0),
      commit({
        advanceTo: T0 + 500,
        deferred: [{ body: {}, oldestTimestamp: T0 + 20, label: "held" }],
      })
    );

    expect(next.lastEventTimestamp).toBe(T0 + 20);
  });
});

describe("the sales record inside FeedStateDO", () => {
  const read = (feed: ReturnType<typeof createFeedStateDO>) =>
    feed.read<SalesFeedState>("sales-state");

  it("reads as absent before anything is written", async () => {
    expect(await read(createFeedStateDO())).toBeNull();
  });

  it("applies the merge on its own side of the input gate", async () => {
    const feed = createFeedStateDO();

    await feed.apply("sales-state", { op: "seed", at: T0 });
    await feed.apply("sales-state", {
      op: "commit",
      processedKeys: ["one"],
      actorGroups: {},
      deferred: [],
      advanceTo: T0 + 30,
    });

    expect(await read(feed)).toEqual({
      lastEventTimestamp: T0 + 30,
      grouping: { actorGroups: {}, processedKeys: ["one"] },
      deferred: [],
    });
  });

  it("rejects an operation it does not recognize", async () => {
    const feed = createFeedStateDO();
    const bad = await feed.apply("sales-state", { op: "wipe" });

    expect(bad.status).toBe(400);
    expect(await read(feed)).toBeNull();
  });

  it("rejects a commit whose advanceTo is not a number", async () => {
    const feed = createFeedStateDO();
    const bad = await feed.apply("sales-state", {
      op: "commit",
      processedKeys: [],
      actorGroups: {},
      deferred: [],
      advanceTo: "now",
    });

    expect(bad.status).toBe(400);
  });

  it("treats a corrupt stored record as absent, which re-seeds", async () => {
    const feed = createFeedStateDO({
      salesState: { lastEventTimestamp: "recently" },
    });

    expect(await read(feed)).toBeNull();
  });
});
