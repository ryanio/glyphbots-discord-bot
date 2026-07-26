/**
 * The cursor store the mint watcher talks to.
 *
 * Splitting the interface out from `FeedStateDO` is what lets the cursor logic
 * be tested without a Durable Object: the tests hand `pollMints` an in-memory
 * store with the same two methods.
 */

import type { WorkerEnv } from "../types";
import type { MintsCursorState } from "./feed-state";

export type MintCursorStore = {
  /** `null` means no cursor has ever been written (cold start). */
  read: () => Promise<MintsCursorState | null>;
  write: (cursor: MintsCursorState) => Promise<void>;
};

/** Fixed name, so every isolate reaches the same instance. */
const SINGLETON = "singleton";

/** Host is ignored by DO routing; it only has to be a valid URL. */
const DO_ORIGIN = "https://feed-state";

export const createMintCursorStore = (env: WorkerEnv): MintCursorStore => {
  const stub = env.FEED_STATE.get(env.FEED_STATE.idFromName(SINGLETON));

  return {
    read: async () => {
      const response = await stub.fetch(`${DO_ORIGIN}/mint-cursor`);
      if (!response.ok) {
        throw new Error(`FeedStateDO read failed: ${response.status}`);
      }
      const body = (await response.json()) as {
        cursor: MintsCursorState | null;
      };
      return body.cursor;
    },
    write: async (cursor) => {
      const response = await stub.fetch(`${DO_ORIGIN}/mint-cursor`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cursor }),
      });
      if (!response.ok) {
        throw new Error(`FeedStateDO write failed: ${response.status}`);
      }
    },
  };
};
