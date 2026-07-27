/**
 * The idle clock's store, the third of the narrow interfaces over
 * `FeedStateDO` (see `./mint-cursor-store.ts` and `./sales-state-store.ts`).
 *
 * One difference from those two, and it is the point of the file. They expose
 * `read` and `write`, and the caller does the read-modify-write on the Worker
 * side. This one exposes `read` and `apply`: the mutation is described, sent to
 * the DO, and applied there. Two independent writers touch this record (the
 * gateway on every human message, the cron once an hour), so a whole-record
 * write from the cron would silently discard a message that arrived while it
 * was building an embed. Sending the operation keeps read and write on the same
 * side of the input gate.
 */

import type { IdleState, IdleUpdate } from "../channels/idle";
import type { WorkerEnv } from "../types";

export type IdleStateStore = {
  /** `null` means nothing has ever been written, which is a cold start. */
  read: () => Promise<IdleState | null>;
  /** Apply one operation inside the DO and return the record it produced. */
  apply: (update: IdleUpdate) => Promise<IdleState>;
};

/** Same instance as the mint cursor and the sales state; one feed DO. */
const SINGLETON = "singleton";

const DO_ORIGIN = "https://feed-state";

export const createIdleStateStore = (env: WorkerEnv): IdleStateStore => {
  const stub = env.FEED_STATE.get(env.FEED_STATE.idFromName(SINGLETON));

  return {
    read: async () => {
      const response = await stub.fetch(`${DO_ORIGIN}/idle-state`);
      if (!response.ok) {
        throw new Error(`FeedStateDO idle read failed: ${response.status}`);
      }
      const body = (await response.json()) as { state: IdleState | null };
      return body.state;
    },
    apply: async (update) => {
      const response = await stub.fetch(`${DO_ORIGIN}/idle-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        throw new Error(`FeedStateDO idle apply failed: ${response.status}`);
      }
      const body = (await response.json()) as { state: IdleState };
      return body.state;
    },
  };
};
