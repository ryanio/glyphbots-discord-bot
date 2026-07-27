/**
 * The state store the sales feed talks to, the twin of
 * `./mint-cursor-store.ts`.
 *
 * Splitting the interface out from `FeedStateDO` is what lets the whole feed,
 * cursor, grouping and deferral included, be tested without a Durable Object:
 * the tests hand `pollSales` an in-memory store with the same two methods, and
 * a simulated restart is just reading back what was written.
 */

import type { SalesFeedState } from "../channels/sales";
import type { WorkerEnv } from "../types";

export type SalesStateStore = {
  /** `null` means nothing has ever been written, which is a cold start. */
  read: () => Promise<SalesFeedState | null>;
  write: (state: SalesFeedState) => Promise<void>;
};

/** Same instance as the mint cursor; one feed DO, two records. */
const SINGLETON = "singleton";

const DO_ORIGIN = "https://feed-state";

export const createSalesStateStore = (env: WorkerEnv): SalesStateStore => {
  const stub = env.FEED_STATE.get(env.FEED_STATE.idFromName(SINGLETON));

  return {
    read: async () => {
      const response = await stub.fetch(`${DO_ORIGIN}/sales-state`);
      if (!response.ok) {
        throw new Error(`FeedStateDO sales read failed: ${response.status}`);
      }
      const body = (await response.json()) as {
        state: SalesFeedState | null;
      };
      return body.state;
    },
    write: async (state) => {
      const response = await stub.fetch(`${DO_ORIGIN}/sales-state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!response.ok) {
        throw new Error(`FeedStateDO sales write failed: ${response.status}`);
      }
    },
  };
};
