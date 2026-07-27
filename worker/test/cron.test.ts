/**
 * Cron dispatch.
 *
 * Four crons share one `scheduled()` handler, so the routing is the only thing
 * standing between a six-hourly gallery post and a five-minutely one, between
 * the sales feed and the mint watcher, which run on the same cadence two
 * minutes apart, and between the hourly idle check and everything else. The
 * collaborators are mocked because this test is about which of them runs, not
 * what they do.
 *
 * The expressions are read out of the real `wrangler.jsonc` rather than
 * written down again here. Copied literals would have made the two lists agree
 * with each other and with nothing else: a cron added to the config and not to
 * `CRON_JOBS` fires into a handler that does not know it, which is exactly the
 * divergence this file exists to catch.
 */

import { describe, expect, it, vi } from "vitest";
import wranglerJsonc from "../wrangler.jsonc?raw";

const calls = vi.hoisted(() => ({
  gallery: 0,
  mints: 0,
  gateway: 0,
  nudge: 0,
  sales: 0,
}));

vi.mock("../src/channels/gallery", () => ({
  postGalleryItem: () => {
    calls.gallery++;
    return Promise.resolve(true);
  },
}));

vi.mock("../src/channels/nudge", () => ({
  runIdleNudge: () => {
    calls.nudge++;
    return Promise.resolve("not-quiet");
  },
}));

// Partial mocks: `FeedStateDO` imports the merge functions out of these two
// modules, and it is reached through `src/index.ts` like everything else here,
// so replacing the whole module leaves the DO without an `apply`.
vi.mock("../src/channels/mints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/channels/mints")>()),
  pollMints: () => {
    calls.mints++;
    return Promise.resolve(0);
  },
}));

vi.mock("../src/channels/sales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/channels/sales")>()),
  pollSales: () => {
    calls.sales++;
    return Promise.resolve(0);
  },
}));

vi.mock("../src/durable-objects/feed-stores", () => ({
  createIdleStateStore: () => ({
    read: () => Promise.resolve(null),
    apply: () => Promise.resolve(null),
  }),
  createMintCursorStore: () => ({
    read: () => Promise.resolve(null),
    apply: () => Promise.resolve(null),
  }),
  createSalesStateStore: () => ({
    read: () => Promise.resolve(null),
    apply: () => Promise.resolve(null),
  }),
}));

vi.mock("../src/durable-objects/gateway-client", () => ({
  createGatewayClient: () => ({
    call: () => {
      calls.gateway++;
      return Promise.resolve({ ok: true });
    },
  }),
}));

vi.mock("../src/discord/channel-poster", () => ({
  createChannelPoster: () => ({ send: () => Promise.resolve() }),
}));

import { CRON_JOBS, dispatchCron } from "../src/index";
import type { WorkerEnv } from "../src/types";

/**
 * Strip `//` comments out of JSONC.
 *
 * `wrangler.jsonc` is heavily commented, so it cannot go through `JSON.parse`
 * directly. This walks the string rather than running a regex over it, because
 * a regex that does not know about string literals would eat the `//` in a URL
 * the first time somebody adds one. Block comments are not handled because the
 * file has none; one would show up here as a parse error rather than as a
 * wrong answer.
 */
const stripLineComments = (source: string): string => {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string;

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        i++;
      }
      out += "\n";
      continue;
    }

    out += char;
  }

  return out;
};

const configuredCrons = (
  JSON.parse(stripLineComments(wranglerJsonc)) as {
    triggers?: { crons?: string[] };
  }
).triggers?.crons;

const env = { DISCORD_TOKEN: "t" } as unknown as WorkerEnv;

const reset = () => {
  calls.gallery = 0;
  calls.mints = 0;
  calls.gateway = 0;
  calls.nudge = 0;
  calls.sales = 0;
};

/** Run one cron and report which collaborators it touched. */
const ran = async (cron: string) => {
  reset();
  await Promise.all(dispatchCron(cron, env));
  return { ...calls };
};

describe("wrangler.jsonc and CRON_JOBS", () => {
  it("declare the same four expressions", () => {
    expect(configuredCrons).toBeDefined();
    expect([...(configuredCrons ?? [])].sort()).toEqual(
      Object.keys(CRON_JOBS).sort()
    );
  });

  it("leaves no configured cron without work", async () => {
    for (const cron of configuredCrons ?? []) {
      const counts = await ran(cron);
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      expect(total, `${cron} ran nothing`).toBeGreaterThan(0);
    }
  });
});

describe("cron dispatch", () => {
  it("runs the mint watcher and the gateway watchdog on the five minute cron", async () => {
    expect(await ran("*/5 * * * *")).toEqual({
      mints: 1,
      gateway: 1,
      gallery: 0,
      sales: 0,
      nudge: 0,
    });
  });

  it("runs only the gallery on the six hour cron", async () => {
    expect(await ran("0 */6 * * *")).toEqual({
      gallery: 1,
      mints: 0,
      gateway: 0,
      sales: 0,
      nudge: 0,
    });
  });

  it("runs only the idle check on the hourly cron", async () => {
    expect(await ran("23 * * * *")).toEqual({
      nudge: 1,
      gallery: 0,
      mints: 0,
      gateway: 0,
      sales: 0,
    });
  });

  it("runs only the sales feed on its offset five minute cron", async () => {
    expect(await ran("2-59/5 * * * *")).toEqual({
      sales: 1,
      mints: 0,
      gallery: 0,
      gateway: 0,
      nudge: 0,
    });
  });

  it("runs nothing at all on an unrecognized expression", async () => {
    // It used to fall through to the mint watcher. A fifth cron added to
    // wrangler.jsonc and forgotten here would then have run the mint tick
    // twice a period while its own job never ran, and nothing anywhere would
    // have said so.
    expect(dispatchCron("* * * * *", env)).toEqual([]);
    expect(await ran("* * * * *")).toEqual({
      mints: 0,
      gateway: 0,
      gallery: 0,
      sales: 0,
      nudge: 0,
    });
  });
});
