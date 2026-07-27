/**
 * The narrow interface everything outside the DO uses to reach the gateway.
 *
 * Same reasoning as `feed-stores.ts`: the callers (the admin routes and
 * the watchdog on the cron) should not know that a Durable Object stub and a
 * fake origin are involved, and keeping the surface to four verbs means the
 * tests can hand a plain object in.
 */

import type { WorkerEnv } from "../types";

export type GatewayCommand = "connect" | "status" | "reconnect" | "health-tick";

export type GatewayClient = {
  /** Returns the DO's JSON response body, whatever it is. */
  call: (command: GatewayCommand) => Promise<unknown>;
};

const SINGLETON = "singleton";

/** The host is ignored by DO routing, it only has to parse. */
const DO_ORIGIN = "https://gateway";

export const createGatewayClient = (env: WorkerEnv): GatewayClient => {
  const stub = env.GATEWAY.get(env.GATEWAY.idFromName(SINGLETON));

  return {
    call: async (command) => {
      const response = await stub.fetch(`${DO_ORIGIN}/${command}`);
      if (!response.ok && response.status !== 200) {
        // The DO answers a JSON body for its own failures (a `failed` state,
        // for instance), so a non-2xx here is a routing or runtime problem.
        const text = await response.text().catch(() => "");
        throw new Error(
          `GatewayDO ${command} failed: ${response.status} ${text.slice(0, 200)}`
        );
      }
      return await response.json();
    },
  };
};
