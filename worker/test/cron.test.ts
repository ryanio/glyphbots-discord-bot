/**
 * Cron dispatch.
 *
 * Two crons share one `scheduled()` handler, so the routing is the only thing
 * standing between a six-hourly gallery post and a five-minutely one. The
 * collaborators are mocked because this test is about which of them runs, not
 * what they do.
 */

import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ gallery: 0, mints: 0, gateway: 0 }));

vi.mock("../src/channels/gallery", () => ({
  postGalleryItem: () => {
    calls.gallery++;
    return Promise.resolve(true);
  },
}));

vi.mock("../src/channels/mints", () => ({
  pollMints: () => {
    calls.mints++;
    return Promise.resolve(0);
  },
}));

vi.mock("../src/durable-objects/gateway-client", () => ({
  createGatewayClient: () => ({
    call: () => {
      calls.gateway++;
      return Promise.resolve({ ok: true });
    },
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
};

describe("cron dispatch", () => {
  it("runs the mint watcher and the gateway watchdog on the five minute cron", async () => {
    reset();
    await Promise.all(dispatchCron("*/5 * * * *", env));
    expect(calls.mints).toBe(1);
    expect(calls.gateway).toBe(1);
    expect(calls.gallery).toBe(0);
  });

  it("runs only the gallery on the six hour cron", async () => {
    reset();
    await Promise.all(dispatchCron("0 */6 * * *", env));
    expect(calls.gallery).toBe(1);
    expect(calls.mints).toBe(0);
    expect(calls.gateway).toBe(0);
  });

  it("falls back to the mint tick on an unrecognized expression", async () => {
    reset();
    await Promise.all(dispatchCron("* * * * *", env));
    expect(calls.mints).toBe(1);
    expect(calls.gallery).toBe(0);
  });
});
