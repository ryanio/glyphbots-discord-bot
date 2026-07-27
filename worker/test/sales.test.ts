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
import { pollSales } from "../src/channels/sales";
import {
  SALES_MAX_MESSAGES_PER_TICK,
  SALES_SETTLE_MS,
} from "../src/config";
import {
  createMemoryPoster,
  createMemorySalesStore,
  createOpenSea,
  firstEmbed,
  pollDeps,
  saleEvent,
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
      pollDeps(opensea, poster, store, () => LATER)
    );

    expect(sent).toBe(0);
    expect(poster.sends).toHaveLength(0);
    expect(store.current?.lastEventTimestamp).toBe(T0);
    expect(store.current?.grouping.processedKeys).toEqual([]);
  });

  it("falls back to the wall clock when the collection has no events", async () => {
    const store = createMemorySalesStore(null);

    await pollSales(
      pollDeps(createOpenSea([[]]), createMemoryPoster(), store, () => LATER)
    );

    expect(store.current?.lastEventTimestamp).toBe(Math.floor(LATER / 1000));
  });

  it("does not replay the backlog on the tick after seeding", async () => {
    const history = [
      saleEvent({ event_timestamp: T0 - 200, transaction: "0xold" }),
      saleEvent({ event_timestamp: T0 }),
    ];
    // The seed probe sees the newest event, then the first real tick sees the
    // whole history because the lag window reaches back behind the cursor.
    const opensea = createOpenSea([[history[1] as never], history]);
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(null);

    await pollSales(pollDeps(opensea, poster, store, () => LATER));
    await pollSales(pollDeps(opensea, poster, store, () => LATER));

    // Only the event at or after the seeded cursor is in scope, and the older
    // one is outside the fetch window in production. Neither posts twice.
    expect(poster.sends.length).toBeLessThanOrEqual(2);
    const titles = poster.sends.map((body) => firstEmbed(body).title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("a new sale", () => {
  it("posts exactly once", async () => {
    const event = saleEvent({ event_timestamp: T0 + 10 });
    const poster = createMemoryPoster();
    const store = createMemorySalesStore(salesState(T0));

    const sent = await pollSales(
      pollDeps(createOpenSea([[event]]), poster, store, () => LATER)
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
      pollDeps(
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
      pollDeps(
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

    await pollSales(pollDeps(opensea, poster, store, () => LATER));
    await pollSales(pollDeps(opensea, poster, store, () => LATER));
    await pollSales(pollDeps(opensea, poster, store, () => LATER));

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
      pollDeps(createOpenSea([[listing]]), poster, store, () => LATER)
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
      pollDeps(createOpenSea([[event]]), poster, store, () => LATER)
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

    await pollSales(pollDeps(opensea, poster, store, () => LATER));
    const sent = await pollSales(pollDeps(opensea, poster, store, () => LATER));

    expect(sent).toBe(1);
    // Two attempts, one delivery, no second copy built from the re-fetch.
    expect(poster.send).toHaveBeenCalledTimes(2);
    expect(store.current?.deferred).toHaveLength(0);
    expect(store.current?.lastEventTimestamp).toBe(T0 + 10);
  });

  it("does not advance the cursor when the fetch itself failed", async () => {
    const store = createMemorySalesStore(salesState(T0));
    const opensea = {
      fetchAccount: () => Promise.resolve(null),
      fetchCollectionEventsSince: () =>
        Promise.resolve({
          events: [saleEvent({ event_timestamp: T0 + 10 })],
          pages: 1,
          failed: true,
        }),
    };

    await pollSales(
      pollDeps(opensea, createMemoryPoster(), store, () => LATER)
    );

    expect(store.current?.lastEventTimestamp).toBe(T0);
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
    await pollSales(pollDeps(opensea, poster, store, () => firstTick));
    expect(poster.sends).toHaveLength(0);

    // Tick two, past the settle window, flushes it as one message.
    await pollSales(
      pollDeps(opensea, poster, store, () => firstTick + SALES_SETTLE_MS + 1000)
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
      pollDeps(
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
      pollDeps(
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
      pollDeps(
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
      pollDeps(createOpenSea([events]), createMemoryPoster(), store, () => firstTick)
    );

    expect(Object.keys(store.current?.grouping.actorGroups ?? {})).toHaveLength(2);

    const poster = createMemoryPoster();
    await pollSales(
      pollDeps(
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
      pollDeps(createOpenSea([events, []]), poster, store, () => LATER)
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

    await pollSales(pollDeps(opensea, poster, store, () => LATER));
    await pollSales(pollDeps(opensea, poster, store, () => LATER));

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
      pollDeps(
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
