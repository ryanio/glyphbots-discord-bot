/**
 * The batcher's own behavior, tested directly rather than through a tick.
 *
 * These are the properties `opensea-activity-bot`'s design notes call out as
 * load bearing, restated against the serializable rewrite: the flush predicate,
 * the duplicate that must not refresh the settle deadline, the stale prune, and
 * the bound on the processed set.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_CONFIG,
  actorKeyFor,
  addEvents,
  collectReadyGroups,
  emptyGroupingState,
  eventKeyFor,
  isProcessed,
  markProcessed,
  processEvents,
} from "../src/channels/sales-grouping";
import {
  SALES_GROUP_STALE_MULTIPLIER,
  SALES_PROCESSED_KEY_HISTORY,
  SALES_SETTLE_MS,
} from "../src/config";
import { saleEvent, sweep } from "./sales-fixtures";

const T0 = 1_760_000_000;

describe("actor keys", () => {
  it("groups sales by buyer, not by transaction", () => {
    const a = saleEvent({ event_timestamp: T0, transaction: "0xone" });
    const b = saleEvent({ event_timestamp: T0 + 1, transaction: "0xtwo" });

    expect(actorKeyFor(a)).toBe(actorKeyFor(b));
    expect(actorKeyFor(a)).toContain("purchase:");
  });

  it("reads the real type out of order_type for order events", () => {
    const listing = saleEvent({
      event_timestamp: T0,
      event_type: "order",
      order_type: "listing",
      maker: "0xAAAA",
    });

    expect(actorKeyFor(listing)).toBe("listing:0xaaaa");
  });

  it("has no key for an event with no actor", () => {
    expect(
      actorKeyFor(saleEvent({ event_timestamp: T0, buyer: undefined }))
    ).toBeUndefined();
  });
});

describe("flush predicate", () => {
  it("waits for both the settle window and the minimum size", () => {
    const state = emptyGroupingState();
    addEvents(state, sweep(2, T0), 1000);

    expect(collectReadyGroups(state, 1000 + SALES_SETTLE_MS - 1).groups).toHaveLength(
      0
    );
    expect(collectReadyGroups(state, 1000 + SALES_SETTLE_MS).groups).toHaveLength(1);
  });

  it("never flushes a group of one, it is released individually instead", () => {
    const state = emptyGroupingState();
    addEvents(state, [saleEvent({ event_timestamp: T0 })], 1000);

    const ready = collectReadyGroups(state, 1000 + SALES_SETTLE_MS);
    expect(ready.groups).toHaveLength(0);
    expect(ready.releasedIndividuals).toHaveLength(0);
  });

  it("releases the survivors when a settled group shrinks below the minimum", () => {
    const state = emptyGroupingState();
    const events = sweep(2, T0);
    addEvents(state, events, 1000);
    markProcessed(state, events[0] as never);

    const ready = collectReadyGroups(state, 1000 + SALES_SETTLE_MS);
    expect(ready.groups).toHaveLength(0);
    expect(ready.releasedIndividuals).toHaveLength(1);
    expect(state.actorGroups).toEqual({});
  });
});

describe("duplicates", () => {
  it("does not refresh the settle deadline, so polling cannot starve a flush", () => {
    const state = emptyGroupingState();
    const events = sweep(2, T0);

    addEvents(state, events, 1000);
    // The lag window re-serves the same events on the next tick.
    addEvents(state, events, 1000 + SALES_SETTLE_MS - 1);

    expect(collectReadyGroups(state, 1000 + SALES_SETTLE_MS).groups).toHaveLength(1);
  });

  it("still counts a duplicate toward rawCount, matching the source", () => {
    const state = emptyGroupingState();
    const one = [saleEvent({ event_timestamp: T0 })];

    addEvents(state, one, 1000);
    addEvents(state, one, 1000);

    const key = actorKeyFor(one[0] as never) as string;
    expect(state.actorGroups[key]?.rawCount).toBe(2);
    expect(state.actorGroups[key]?.events).toHaveLength(1);
  });
});

describe("stale groups", () => {
  it("drops an under-sized group after settleMs * 3", () => {
    const state = emptyGroupingState();
    addEvents(state, [saleEvent({ event_timestamp: T0 })], 1000);

    collectReadyGroups(
      state,
      1000 + SALES_SETTLE_MS * SALES_GROUP_STALE_MULTIPLIER
    );

    expect(state.actorGroups).toEqual({});
  });
});

describe("processed keys", () => {
  it("rejects an event it has already seen", () => {
    const state = emptyGroupingState();
    const event = saleEvent({ event_timestamp: T0 });

    expect(isProcessed(state, event)).toBe(false);
    markProcessed(state, event);
    expect(isProcessed(state, event)).toBe(true);
  });

  it("keys a sale on its transaction, so two tokens in one tx stay distinct", () => {
    const a = saleEvent({
      event_timestamp: T0,
      nft: { identifier: "1" },
      transaction: "0xsame",
    });
    const b = saleEvent({
      event_timestamp: T0,
      nft: { identifier: "2" },
      transaction: "0xsame",
    });

    expect(eventKeyFor(a)).not.toBe(eventKeyFor(b));
  });

  it("stays bounded", () => {
    const state = emptyGroupingState();
    for (let i = 0; i < SALES_PROCESSED_KEY_HISTORY + 50; i++) {
      markProcessed(
        state,
        saleEvent({ event_timestamp: T0 + i, transaction: `0x${i}` })
      );
    }

    expect(state.processedKeys).toHaveLength(SALES_PROCESSED_KEY_HISTORY);
    expect(state.processedKeys.at(-1)).toContain(
      String(T0 + SALES_PROCESSED_KEY_HISTORY + 49)
    );
  });
});

describe("processEvents", () => {
  it("holds members of a pending large group back from individual posting", () => {
    const state = emptyGroupingState();
    const result = processEvents(state, sweep(3, T0), 1000);

    expect(result.readyGroups).toHaveLength(0);
    expect(result.processableEvents).toHaveLength(0);
    expect(result.skippedPending).toBe(3);
  });

  it("flushes on an empty tick, which is what makes a cron enough", () => {
    const state = emptyGroupingState();
    processEvents(state, sweep(3, T0), 1000);

    const result = processEvents(state, [], 1000 + SALES_SETTLE_MS, DEFAULT_GROUP_CONFIG);

    expect(result.readyGroups).toHaveLength(1);
    expect(result.readyGroups[0]?.events).toHaveLength(3);
  });

  it("round-trips through JSON without changing what it does", () => {
    const state = emptyGroupingState();
    processEvents(state, sweep(3, T0), 1000);

    const revived = JSON.parse(JSON.stringify(state)) as typeof state;
    const result = processEvents(revived, [], 1000 + SALES_SETTLE_MS);

    expect(result.readyGroups[0]?.events).toHaveLength(3);
  });
});
