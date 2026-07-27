/**
 * The narrow interfaces the feeds reach `FeedStateDO` through.
 *
 * All three are the same two methods over the same singleton instance, so they
 * are one factory here rather than three near-identical files that differed
 * only in an error string.
 *
 * ## Why `read` and `apply` rather than `read` and `write`
 *
 * A cron tick reads a record, does several seconds of network work, then wants
 * to store the result. Written as `read` then `write`, that is a
 * read-modify-write with a Discord post in the middle and the two halves on
 * opposite sides of the DO's input gate: the gate serializes each `fetch`, not
 * the pair, so a tick that overlapped this one has its record silently
 * replaced. The mint watcher would drop posted ids and repost; the sales feed
 * would drop processed keys and repost.
 *
 * So the caller sends *what changed* and the DO reads, applies and writes
 * without yielding. The second thing this buys is smaller: the DO validates a
 * small operation instead of a whole record, so there is no path where a post
 * succeeds and the write that records it is then rejected as malformed, which
 * would repost on the next tick.
 *
 * ## Why an interface at all
 *
 * Splitting it out from `FeedStateDO` is what lets every feed be tested
 * without a Durable Object: the tests hand `pollMints` and `pollSales` an
 * in-memory store with the same two methods, running the same shipped merge.
 */

import type { IdleState, IdleUpdate } from "../channels/idle";
import type { MintCursorUpdate, MintsCursorState } from "../channels/mints";
import type { SalesFeedState, SalesUpdate } from "../channels/sales";
import type { WorkerEnv } from "../types";

export type FeedStore<State, Update> = {
  /** `null` means nothing has ever been written, which is a cold start. */
  read: () => Promise<State | null>;
  /** Apply one operation inside the DO and return the record it produced. */
  apply: (update: Update) => Promise<State>;
};

export type MintCursorStore = FeedStore<MintsCursorState, MintCursorUpdate>;
export type SalesStateStore = FeedStore<SalesFeedState, SalesUpdate>;
export type IdleStateStore = FeedStore<IdleState, IdleUpdate>;

/** Fixed name, so every isolate reaches the same instance. */
const SINGLETON = "singleton";

/** Host is ignored by DO routing; it only has to be a valid URL. */
const DO_ORIGIN = "https://feed-state";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * One record's worth of client. `path` picks the record and `label` is what
 * shows up in the error when the DO refuses.
 */
const createFeedStore = <State, Update>(
  env: WorkerEnv,
  path: string,
  label: string
): FeedStore<State, Update> => {
  const stub = env.FEED_STATE.get(env.FEED_STATE.idFromName(SINGLETON));
  const url = `${DO_ORIGIN}/${path}`;

  return {
    read: async () => {
      const response = await stub.fetch(url);
      if (!response.ok) {
        throw new Error(`FeedStateDO ${label} read failed: ${response.status}`);
      }
      const body = (await response.json()) as { state: State | null };
      return body.state;
    },
    apply: async (update) => {
      const response = await stub.fetch(url, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        throw new Error(
          `FeedStateDO ${label} apply failed: ${response.status}`
        );
      }
      const body = (await response.json()) as { state: State };
      return body.state;
    },
  };
};

export const createMintCursorStore = (env: WorkerEnv): MintCursorStore =>
  createFeedStore(env, "mint-cursor", "mint cursor");

export const createSalesStateStore = (env: WorkerEnv): SalesStateStore =>
  createFeedStore(env, "sales-state", "sales state");

export const createIdleStateStore = (env: WorkerEnv): IdleStateStore =>
  createFeedStore(env, "idle-state", "idle state");
