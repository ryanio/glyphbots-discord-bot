/**
 * Cron dispatch.
 *
 * Four crons share one `scheduled()` handler, so the routing is the only thing
 * standing between a six-hourly gallery post and a five-minutely one, between
 * the sales feed and the mint watcher, which run on the same cadence two
 * minutes apart, and between the hourly idle check and everything else. The
 * collaborators are mocked because this test is about which of them runs, not
 * what they do.
 */

import { describe, expect, it, vi } from "vitest";

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

vi.mock("../src/channels/mints", () => ({
  pollMints: () => {
    calls.mints++;
    return Promise.resolve(0);
  },
}));

vi.mock("../src/channels/sales", () => ({
  pollSales: () => {
    calls.sales++;
    return Promise.resolve(0);
  },
}));

vi.mock("../src/durable-objects/sales-state-store", () => ({
  createSalesStateStore: () => ({
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
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

vi.mock("../src/durable-objects/idle-state-store", () => ({
  createIdleStateStore: () => ({
    read: () => Promise.resolve(null),
    apply: () => Promise.resolve(null),
  }),
}));

vi.mock("../src/durable-objects/mint-cursor-store", () => ({
  createMintCursorStore: () => ({
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  }),
}));

vi.mock("../src/discord/channel-poster", () => ({
  createChannelPoster: () => ({ send: () => Promise.resolve() }),
}));

import { dispatchCron } from "../src/index";
import type { WorkerEnv } from "../src/types";

const env = { DISCORD_TOKEN: "t" } as unknown as WorkerEnv;

const reset = () => {
  calls.gallery = 0;
  calls.mints = 0;
  calls.gateway = 0;
  calls.nudge = 0;
  calls.sales = 0;
};

describe("cron dispatch", () => {
  it("runs the mint watcher and the gateway watchdog on the five minute cron", async () => {
    reset();
    await Promise.all(dispatchCron("*/5 * * * *", env));
    expect(calls.mints).toBe(1);
    expect(calls.gateway).toBe(1);
    expect(calls.gallery).toBe(0);
    expect(calls.sales).toBe(0);
    expect(calls.nudge).toBe(0);
  });

  it("runs only the gallery on the six hour cron", async () => {
    reset();
    await Promise.all(dispatchCron("0 */6 * * *", env));
    expect(calls.gallery).toBe(1);
    expect(calls.mints).toBe(0);
    expect(calls.gateway).toBe(0);
    expect(calls.sales).toBe(0);
    expect(calls.nudge).toBe(0);
  });

  it("runs only the idle check on the hourly cron", async () => {
    reset();
    await Promise.all(dispatchCron("23 * * * *", env));
    expect(calls.nudge).toBe(1);
    expect(calls.gallery).toBe(0);
    expect(calls.mints).toBe(0);
    expect(calls.gateway).toBe(0);
    expect(calls.sales).toBe(0);
  });

  it("runs only the sales feed on its offset five minute cron", async () => {
    reset();
    await Promise.all(dispatchCron("2-59/5 * * * *", env));
    expect(calls.sales).toBe(1);
    expect(calls.mints).toBe(0);
    expect(calls.gallery).toBe(0);
    expect(calls.gateway).toBe(0);
    expect(calls.nudge).toBe(0);
  });

  it("falls back to the mint tick on an unrecognized expression", async () => {
    reset();
    await Promise.all(dispatchCron("* * * * *", env));
    expect(calls.mints).toBe(1);
    expect(calls.gallery).toBe(0);
  });
});
