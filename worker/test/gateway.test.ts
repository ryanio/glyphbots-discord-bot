/**
 * GatewayDO coverage, driven through a stub socket and a stub
 * `DurableObjectState`.
 *
 * What this can and cannot reach is worth being explicit about. Everything
 * below the network is covered: frame parsing, the HELLO to IDENTIFY or RESUME
 * decision, sequence tracking, heartbeat and ack tracking, the close-code
 * table and the exact backoff it schedules, the MESSAGE_CREATE route into the
 * lookup path, and the connect path's own bookkeeping (the in-flight guard,
 * the `wsState` it reports) driven through a stubbed upgrade.
 *
 * What is not covered, and cannot be without a deploy, is what happens on the
 * other side of that stub: whether `/gateway/bot` answers, whether the 101
 * upgrade succeeds, and whether Discord accepts the IDENTIFY. Those are listed
 * in the README under what remains unverified.
 */

import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERAL_CHANNEL_ID,
  GUILD_ID,
  TRADING_FLOOR_CHANNEL_ID,
} from "../src/config";
import {
  BACKOFF_MS,
  classifyClose,
  GATEWAY_INTENTS,
  GatewayDO,
  type GatewayState,
  parseFrame,
  parseMessageCreate,
} from "../src/durable-objects/gateway";
import type { WorkerEnv } from "../src/types";
import { at, firstEmbed } from "./fixtures";

/**
 * One teardown for the whole file rather than a restore at the end of each
 * test. A `mockRestore()` written after the assertions never runs when an
 * assertion fails, so a stubbed `Math.random` or `fetch` used to leak into
 * every test that followed the first failure.
 */
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * The reply goes out through `@discordjs/rest`, which has its own HTTP stack
 * and does not go through `globalThis.fetch`, so spying on fetch would let a
 * test post at the real Discord API. The module is replaced instead, and the
 * posts land in `posted`.
 */
const posted = vi.hoisted(
  () =>
    [] as Array<{
      channelId: string;
      body: RESTPostAPIChannelMessageJSONBody;
    }>
);

vi.mock("../src/discord/channel-poster", () => ({
  createChannelPoster: (_env: unknown, channelId: string) => ({
    send: (body: RESTPostAPIChannelMessageJSONBody) => {
      posted.push({ channelId, body });
      return Promise.resolve();
    },
  }),
}));

/** Enough of `DurableObjectState` for the DO's storage and alarm use. */
const createFakeState = () => {
  const store = new Map<string, unknown>();
  const alarms: number[] = [];
  let alarm: number | null = null;
  let deletes = 0;

  return {
    /**
     * Every absolute time handed to `setAlarm`, in order.
     *
     * This used to be declared and never written to, so every alarm assertion
     * in the file was really just "an alarm exists", which is how a backoff
     * that skipped its first step went unnoticed.
     */
    alarms,
    /** How many times the alarm was deleted, which is how `failed` parks. */
    get alarmDeletes() {
      return deletes;
    },
    get alarmAt() {
      return alarm;
    },
    /** The alarms as delays, which is the thing the backoff is about. */
    delaysFrom(base: number) {
      return alarms.map((at) => at - base);
    },
    get stored() {
      return store.get("gatewayState") as GatewayState | undefined;
    },
    seed(state: Partial<GatewayState>) {
      store.set("gatewayState", state);
    },
    storage: {
      get: <T>(key: string) => Promise.resolve(store.get(key) as T | undefined),
      put: (key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      },
      getAlarm: () => Promise.resolve(alarm),
      setAlarm: (at: number) => {
        alarm = at;
        alarms.push(at);
        return Promise.resolve();
      },
      deleteAlarm: () => {
        alarm = null;
        deletes += 1;
        return Promise.resolve();
      },
    },
  };
};

/**
 * A `fetch` that fails loudly rather than reaching the network.
 *
 * `vi.spyOn(globalThis, "fetch")` with no implementation calls straight
 * through, so a test whose only assertion is `not.toHaveBeenCalled()` is one
 * edit away from talking to the real discord.com.
 */
const denyFetch = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      throw new Error(`test made an unexpected network call: ${url}`);
    });

const createFakeSocket = () => {
  const sent: Record<string, unknown>[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  return {
    sent,
    closes,
    send: (raw: string) => {
      sent.push(JSON.parse(raw) as Record<string, unknown>);
    },
    close: (code: number, reason: string) => {
      closes.push({ code, reason });
    },
  };
};

/**
 * What a successful upgrade hands back: a socket `openGateway` will `accept()`
 * and attach listeners to. Records both so a test can count how many sockets
 * the DO actually took ownership of.
 */
const createUpgradedSocket = () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const sent: Record<string, unknown>[] = [];
  let accepted = 0;
  return {
    listeners,
    sent,
    get accepted() {
      return accepted;
    },
    accept: () => {
      accepted += 1;
    },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(type, fn);
    },
    send: (raw: string) => {
      sent.push(JSON.parse(raw) as Record<string, unknown>);
    },
    close: () => {},
  };
};

/**
 * A stand-in for the `FEED_STATE` namespace.
 *
 * The DO needs one because `MESSAGE_CREATE` now writes the idle clock through
 * to `FeedStateDO` (`src/channels/idle.ts`). The stub records what would have
 * been sent, which is what the idle-clock tests below assert on.
 */
const createFeedStateStub = () => {
  const applied: unknown[] = [];
  return {
    applied,
    binding: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (_url: string, init?: RequestInit) => {
          if (init?.body) {
            applied.push(JSON.parse(String(init.body)) as unknown);
          }
          return Response.json({ state: null });
        },
      }),
    },
  };
};

const env = (overrides: Partial<WorkerEnv> = {}) =>
  ({
    DISCORD_TOKEN: "test-token",
    DISCORD_APP_ID: "app",
    FEED_STATE: createFeedStateStub().binding,
    ...overrides,
  }) as unknown as WorkerEnv;

type Harness = {
  doInstance: GatewayDO;
  state: ReturnType<typeof createFakeState>;
  ws: ReturnType<typeof createFakeSocket>;
};

const harness = (seed: Partial<GatewayState> = {}): Harness => {
  const state = createFakeState();
  if (Object.keys(seed).length > 0) {
    state.seed(seed);
  }
  const doInstance = new GatewayDO(
    state as unknown as DurableObjectState,
    env()
  );
  return { doInstance, state, ws: createFakeSocket() };
};

const frame = (payload: Record<string, unknown>): string =>
  JSON.stringify(payload);

describe("frame parsing", () => {
  it("reads a well-formed frame", () => {
    expect(parseFrame(frame({ op: 0, s: 5, t: "READY", d: { a: 1 } }))).toEqual(
      {
        op: 0,
        s: 5,
        t: "READY",
        d: { a: 1 },
      }
    );
  });

  it("rejects anything that is not a frame", () => {
    expect(parseFrame("not json")).toBeNull();
    expect(parseFrame("null")).toBeNull();
    expect(parseFrame(frame({ t: "READY" }))).toBeNull();
  });

  it("narrows a MESSAGE_CREATE payload", () => {
    expect(
      parseMessageCreate({
        id: "1",
        channel_id: "2",
        guild_id: "3",
        content: "b#1",
        author: { id: "4", bot: false, username: "x" },
        extra: "ignored",
      })
    ).toEqual({
      id: "1",
      channel_id: "2",
      guild_id: "3",
      content: "b#1",
      author: { id: "4", bot: false, username: "x" },
    });
  });

  it("rejects a MESSAGE_CREATE missing a required field", () => {
    expect(parseMessageCreate({ id: "1", channel_id: "2" })).toBeNull();
    expect(parseMessageCreate(null)).toBeNull();
  });
});

describe("the close-code table", () => {
  it("treats the six unrecoverable codes as fatal", () => {
    for (const code of [4004, 4010, 4011, 4012, 4013, 4014]) {
      expect(classifyClose(code)).toBe("fatal");
    }
  });

  it("re-identifies on a dead session", () => {
    expect(classifyClose(4007)).toBe("reidentify");
    expect(classifyClose(4009)).toBe("reidentify");
  });

  it("resumes on everything else", () => {
    for (const code of [1000, 1001, 1006, 4000, 4001, 4002, 4003, 4005, 4008]) {
      expect(classifyClose(code)).toBe("resume");
    }
  });
});

describe("closing the socket", () => {
  it("parks in failed on a fatal code and schedules nothing", async () => {
    const { doInstance, state } = harness({ wsState: "live" });

    await doInstance.handleSocketClose(4014, "Disallowed intents");

    expect(state.stored?.wsState).toBe("failed");
    expect(state.stored?.failureReason).toContain("4014");
    expect(state.alarmAt).toBeNull();
  });

  it("keeps the session on a resumable code and backs off", async () => {
    vi.useFakeTimers();
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(base);

    const { doInstance, state } = harness({
      wsState: "live",
      sessionId: "sess",
      resumeUrl: "wss://resume.example",
      lastSeq: 42,
      reconnectAttempt: 0,
    });

    await doInstance.handleSocketClose(4000, "Unknown error");

    expect(state.stored?.wsState).toBe("reconnecting");
    expect(state.stored?.sessionId).toBe("sess");
    expect(state.stored?.lastSeq).toBe(42);
    expect(state.stored?.reconnectAttempt).toBe(1);
    // The first close waits the first step, not the second.
    expect(state.delaysFrom(base)).toEqual([BACKOFF_MS[0]]);
  });

  it("drops the session on a re-identify code", async () => {
    const { doInstance, state } = harness({
      wsState: "live",
      sessionId: "sess",
      resumeUrl: "wss://resume.example",
      lastSeq: 42,
    });

    await doInstance.handleSocketClose(4009, "Session timed out");

    expect(state.stored?.wsState).toBe("reconnecting");
    expect(state.stored?.sessionId).toBeNull();
    expect(state.stored?.resumeUrl).toBeNull();
    expect(state.stored?.lastSeq).toBeNull();
  });

  it("walks the backoff up one step per close and stops at the ceiling", async () => {
    vi.useFakeTimers();
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(base);

    const { doInstance, state } = harness({ wsState: "live" });

    for (let close = 0; close < BACKOFF_MS.length + 1; close += 1) {
      await doInstance.handleSocketClose(4000, `close ${close}`);
    }

    // The ladder the README documents, exactly: one step per consecutive
    // close, starting at 1s, held at 60s. Seeding at the ceiling and closing
    // once (which is what this test used to do) asserts none of it.
    expect(state.delaysFrom(base)).toEqual([
      1000, 2000, 5000, 15_000, 60_000, 60_000,
    ]);
    expect(state.stored?.reconnectAttempt).toBe(BACKOFF_MS.length - 1);
  });

  it("goes back to the first step once a READY lands", async () => {
    vi.useFakeTimers();
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(base);

    const { doInstance, ws, state } = harness({
      wsState: "live",
      reconnectAttempt: BACKOFF_MS.length - 1,
    });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 0, s: 1, t: "READY", d: { user: { id: "bot-id" } } })
    );
    await doInstance.handleSocketClose(4000, "after a good session");

    expect(state.delaysFrom(base)).toEqual([BACKOFF_MS[0]]);
  });
});

describe("the HELLO handshake", () => {
  it("IDENTIFYs with only the three intents when there is no session", async () => {
    const { doInstance, ws, state } = harness();

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 10, d: { heartbeat_interval: 41_250 } })
    );

    const identify = ws.sent[0] as {
      op: number;
      d: { intents: number; token: string };
    };
    expect(identify.op).toBe(2);
    expect(identify.d.intents).toBe(GATEWAY_INTENTS);
    // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT, and nothing privileged beyond
    // MESSAGE_CONTENT.
    expect(GATEWAY_INTENTS).toBe((1 << 0) | (1 << 9) | (1 << 15));
    expect(state.stored?.wsState).toBe("identifying");
    expect(state.stored?.heartbeatIntervalMs).toBe(41_250);
  });

  it("RESUMEs when a session and a sequence survive", async () => {
    const { doInstance, ws } = harness({
      sessionId: "sess",
      lastSeq: 17,
      resumeUrl: "wss://resume.example",
    });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 10, d: { heartbeat_interval: 41_250 } })
    );

    const resume = ws.sent[0] as {
      op: number;
      d: { session_id: string; seq: number };
    };
    expect(resume.op).toBe(6);
    expect(resume.d.session_id).toBe("sess");
    expect(resume.d.seq).toBe(17);
  });

  it("jitters the first heartbeat inside the interval", async () => {
    // The `Math.random` stub is undone by the file-wide `afterEach`, so a
    // failure below cannot leave a deterministic `Math.random` behind for the
    // rest of the suite.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(base);

    const { doInstance, ws, state } = harness();

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 10, d: { heartbeat_interval: 40_000 } })
    );

    expect(state.delaysFrom(base)).toEqual([20_000]);
  });
});

describe("dispatches and heartbeats", () => {
  it("stores the session, resume url and self id on READY", async () => {
    const { doInstance, ws, state } = harness();

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({
        op: 0,
        s: 1,
        t: "READY",
        d: {
          session_id: "sess",
          resume_gateway_url: "wss://resume.example",
          user: { id: "bot-id" },
        },
      })
    );

    expect(state.stored?.wsState).toBe("live");
    expect(state.stored?.sessionId).toBe("sess");
    expect(state.stored?.resumeUrl).toBe("wss://resume.example");
    expect(state.stored?.selfUserId).toBe("bot-id");
    expect(state.stored?.lastSeq).toBe(1);
    expect(state.stored?.reconnectAttempt).toBe(0);
  });

  it("goes live again on RESUMED", async () => {
    const { doInstance, ws, state } = harness({
      wsState: "reconnecting",
      reconnectAttempt: 3,
    });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 0, s: 9, t: "RESUMED", d: {} })
    );

    expect(state.stored?.wsState).toBe("live");
    expect(state.stored?.reconnectAttempt).toBe(0);
  });

  it("clears the pending ack on op 11", async () => {
    const { doInstance, ws, state } = harness({ heartbeatAckPending: true });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 11 })
    );

    expect(state.stored?.heartbeatAckPending).toBe(false);
  });

  it("heartbeats immediately when the gateway asks (op 1)", async () => {
    const { doInstance, ws, state } = harness({ lastSeq: 12 });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 1 })
    );

    expect(ws.sent[0]).toEqual({ op: 1, d: 12 });
    expect(state.stored?.heartbeatAckPending).toBe(true);
  });

  it("closes and reconnects on op 7", async () => {
    const { doInstance, ws, state } = harness({ wsState: "live" });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 7 })
    );

    expect(state.alarmAt).not.toBeNull();
  });

  it("forgets the session on a non-resumable INVALID_SESSION", async () => {
    vi.useFakeTimers();
    const { doInstance, ws, state } = harness({
      sessionId: "sess",
      lastSeq: 5,
      resumeUrl: "wss://resume.example",
    });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 9, d: false })
    );

    expect(state.stored?.sessionId).toBeNull();
    expect(state.stored?.lastSeq).toBeNull();
    expect(state.stored?.consecutiveResumeFailures).toBe(1);

    // The re-IDENTIFY is deferred by 1 to 5 seconds, as the protocol asks.
    expect(ws.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect((ws.sent[0] as { op: number }).op).toBe(2);
  });

  it("keeps the session on a resumable INVALID_SESSION", async () => {
    vi.useFakeTimers();
    const { doInstance, ws, state } = harness({
      sessionId: "sess",
      lastSeq: 5,
    });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 9, d: true })
    );

    expect(state.stored?.sessionId).toBe("sess");
    await vi.advanceTimersByTimeAsync(5000);
  });

  it("tracks the sequence number off every dispatch", async () => {
    const { doInstance, ws, state } = harness();

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({ op: 0, s: 77, t: "TYPING_START", d: {} })
    );

    expect(state.stored?.lastSeq).toBe(77);
  });
});

describe("the alarm", () => {
  it("reconnects rather than heartbeating when there is no live socket", async () => {
    // `liveWs` is null on a fresh instance, which is exactly the state a DO
    // comes back in after eviction. It must reopen, not send into nothing.
    const { doInstance, state } = harness({
      wsState: "live",
      heartbeatIntervalMs: 41_250,
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("nope", { status: 500 }));

    await doInstance.alarm();

    expect(fetchSpy).toHaveBeenCalled();
    expect(state.stored?.wsState).toBe("reconnecting");
  });

  /**
   * A fatal close nulls `liveWs` before it writes `failed`, so the two always
   * arrive together. While the null-socket branch was tested first, `failed`
   * was unreachable and the only thing standing between a 4014 and a reconnect
   * loop was `clearAlarm` winning a race against the alarm `onHello` sets
   * immediately before the IDENTIFY that earns the 4014.
   */
  it("stays parked in failed when an alarm fires after a fatal close", async () => {
    const { doInstance, state } = harness({
      wsState: "live",
      heartbeatIntervalMs: 41_250,
    });
    const fetchSpy = denyFetch();

    await doInstance.handleSocketClose(4014, "Disallowed intents");
    expect(state.stored?.wsState).toBe("failed");

    // The alarm that was already in flight when the 4014 landed.
    await doInstance.alarm();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.stored?.wsState).toBe("failed");
    expect(state.stored?.failureReason).toContain("4014");
    expect(state.alarms).toHaveLength(0);
    expect(state.alarmAt).toBeNull();
  });

  it("leaves a failed gateway alone on the watchdog tick too", async () => {
    const { doInstance, state } = harness({ wsState: "live" });
    const fetchSpy = denyFetch();

    await doInstance.handleSocketClose(4014, "Disallowed intents");
    const response = await doInstance.fetch(
      new Request("https://gateway/health-tick")
    );

    expect(await response.json()).toMatchObject({
      ok: false,
      wsState: "failed",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.stored?.wsState).toBe("failed");
  });
});

describe("opening the socket", () => {
  /**
   * `liveWs` is assigned only after the upgrade `fetch` resolves, and a
   * Durable Object's input gate closes around storage operations, not around
   * an `await fetch`. So a heartbeat alarm firing while the watchdog was
   * mid-connect used to sail past the `liveWs` check and accept a second
   * socket, and both sockets kept their listeners: every MESSAGE_CREATE
   * handled twice, every inline lookup answered twice.
   */
  it("does not open a second socket when a connect is already in flight", async () => {
    const { doInstance, state } = harness({
      wsState: "reconnecting",
      sessionId: "sess",
      resumeUrl: "wss://resume.example",
      lastSeq: 5,
    });

    const sockets: ReturnType<typeof createUpgradedSocket>[] = [];
    let releaseUpgrade = () => {};
    const upgrade = new Promise<void>((resolve) => {
      releaseUpgrade = resolve;
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        // Held open so both callers are past the guard before either finishes,
        // which is the race as it happens in production.
        await upgrade;
        const ws = createUpgradedSocket();
        sockets.push(ws);
        return { status: 101, webSocket: ws } as unknown as Response;
      });

    const viaAlarm = doInstance.alarm();
    const viaWatchdog = doInstance.fetch(
      new Request("https://gateway/health-tick")
    );
    releaseUpgrade();
    await Promise.all([viaAlarm, viaWatchdog]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.accepted).toBe(1);
    expect(state.stored?.wsState).toBe("connecting");
  });

  it("abandons a connect that never settles so the watchdog can retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-01-01T00:00:00.000Z"));

    const { doInstance } = harness({
      wsState: "reconnecting",
      sessionId: "sess",
      resumeUrl: "wss://resume.example",
      lastSeq: 5,
    });

    // The upgrade that never comes back. Joining this forever would be the
    // failure the watchdog exists to break, so the guard has to expire.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => new Promise<Response>(() => {}));

    void doInstance.alarm();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Inside the minute, another caller joins rather than opening a socket.
    await vi.advanceTimersByTimeAsync(30_000);
    void doInstance.alarm();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past it, the wedged reference is dropped and a fresh connect starts.
    await vi.advanceTimersByTimeAsync(31_000);
    void doInstance.alarm();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reports connecting for the whole connect, discovery included", async () => {
    const { doInstance, state } = harness({ wsState: "idle" });

    const observed: (string | undefined)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      observed.push(state.stored?.wsState);
      return Response.json({ url: "wss://gateway.example" });
    });

    // The upgrade then fails, which is fine: the assertion is about what the
    // status route would have reported while `/gateway/bot` was outstanding.
    await doInstance.fetch(new Request("https://gateway/connect"));

    expect(observed[0]).toBe("connecting");
  });
});

describe("MESSAGE_CREATE routing", () => {
  beforeEach(() => {
    posted.length = 0;
  });

  it("answers a lookup in an allowed channel", async () => {
    const state = createFakeState();
    state.seed({ wsState: "live", selfUserId: "bot-id" });
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env()
    );
    const ws = createFakeSocket();

    // Each upstream needs its own answer: a GlyphBots reply that does not
    // carry a bot resolves to null, no embed is built, and nothing is posted,
    // which would make this test pass for the wrong reason.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/api/bot/")) {
          return Promise.resolve(
            Response.json({
              bot: {
                id: "bot-1",
                name: "GlyphBot #1 - Vector",
                tokenId: 1,
                traits: [],
                rarityRank: 1,
                burnedAt: null,
                burnedBy: null,
              },
            })
          );
        }
        return Promise.resolve(Response.json({ id: "posted" }));
      });

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({
        op: 0,
        s: 2,
        t: "MESSAGE_CREATE",
        d: {
          id: "m1",
          channel_id: GENERAL_CHANNEL_ID,
          guild_id: GUILD_ID,
          content: "b#1",
          author: { id: "human" },
        },
      })
    );

    const urls = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes("/api/bot/1"))).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.channelId).toBe(GENERAL_CHANNEL_ID);
    expect(firstEmbed(at(posted).body).title).toBe("GlyphBot #1");
  });

  it("spends nothing on a message in a channel it does not serve", async () => {
    const state = createFakeState();
    state.seed({ wsState: "live", selfUserId: "bot-id" });
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env()
    );
    const ws = createFakeSocket();
    const fetchSpy = denyFetch();

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({
        op: 0,
        s: 3,
        t: "MESSAGE_CREATE",
        d: {
          id: "m1",
          channel_id: TRADING_FLOOR_CHANNEL_ID,
          guild_id: GUILD_ID,
          content: "b#1",
          author: { id: "human" },
        },
      })
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    // Free of network work, but the frame still counts: see the sequence
    // tests below.
    expect(state.stored?.lastSeq).toBe(3);
  });

  it("moves the idle clock forward on a human message in #general", async () => {
    const state = createFakeState();
    state.seed({ wsState: "live", selfUserId: "bot-id" });
    const feed = createFeedStateStub();
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env({ FEED_STATE: feed.binding as unknown as DurableObjectNamespace })
    );
    const ws = createFakeSocket();

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({
        op: 0,
        s: 5,
        t: "MESSAGE_CREATE",
        d: {
          id: "m1",
          channel_id: GENERAL_CHANNEL_ID,
          guild_id: GUILD_ID,
          // Ordinary conversation, not a lookup. It still counts as the room
          // being alive, which is the whole point of recording it here rather
          // than inside the lookup path.
          content: "morning all",
          author: { id: "human" },
        },
      })
    );

    expect(feed.applied).toHaveLength(1);
    expect((feed.applied[0] as { op: string }).op).toBe("human-message");
    expect(state.stored?.lastSeq).toBe(5);
  });

  it("does not let its own post reset the idle clock", async () => {
    const state = createFakeState();
    state.seed({ wsState: "live", selfUserId: "bot-id" });
    const feed = createFeedStateStub();
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env({ FEED_STATE: feed.binding as unknown as DurableObjectNamespace })
    );
    const ws = createFakeSocket();

    // The nudge, coming back off the gateway as any other message would. If
    // this reset the clock the bot would nudge once and then never again.
    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({
        op: 0,
        s: 6,
        t: "MESSAGE_CREATE",
        d: {
          id: "m2",
          channel_id: GENERAL_CHANNEL_ID,
          guild_id: GUILD_ID,
          content: "",
          author: { id: "bot-id", bot: true },
        },
      })
    );

    expect(feed.applied).toHaveLength(0);
  });

  it("does not count chatter in a channel it does not watch", async () => {
    const state = createFakeState();
    state.seed({ wsState: "live", selfUserId: "bot-id" });
    const feed = createFeedStateStub();
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env({ FEED_STATE: feed.binding as unknown as DurableObjectNamespace })
    );
    const ws = createFakeSocket();

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({
        op: 0,
        s: 7,
        t: "MESSAGE_CREATE",
        d: {
          id: "m3",
          channel_id: TRADING_FLOOR_CHANNEL_ID,
          guild_id: GUILD_ID,
          content: "gm",
          author: { id: "human" },
        },
      })
    );

    expect(feed.applied).toHaveLength(0);
  });

  it("never answers itself", async () => {
    const state = createFakeState();
    state.seed({ wsState: "live", selfUserId: "bot-id" });
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env()
    );
    const ws = createFakeSocket();
    const fetchSpy = denyFetch();

    await doInstance.handleSocketMessage(
      ws as unknown as WebSocket,
      frame({
        op: 0,
        s: 4,
        t: "MESSAGE_CREATE",
        d: {
          id: "m1",
          channel_id: GENERAL_CHANNEL_ID,
          guild_id: GUILD_ID,
          content: "b#1",
          author: { id: "bot-id" },
        },
      })
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * The sequence number is what RESUME replays from, so it has to track the
 * frames the gateway sent, not the subset this bot found interesting.
 */
describe("the sequence number across a reconnect", () => {
  it("advances on chatter it never answers", async () => {
    const state = createFakeState();
    state.seed({ wsState: "live", selfUserId: "bot-id", lastSeq: 200 });
    const feed = createFeedStateStub();
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env({ FEED_STATE: feed.binding as unknown as DurableObjectNamespace })
    );
    const ws = createFakeSocket();
    const fetchSpy = denyFetch();

    const lines = ["gm", "wen mint", "lol"];
    for (const [index, content] of lines.entries()) {
      await doInstance.handleSocketMessage(
        ws as unknown as WebSocket,
        frame({
          op: 0,
          s: 201 + index,
          t: "MESSAGE_CREATE",
          d: {
            id: `m${index}`,
            channel_id: TRADING_FLOOR_CHANNEL_ID,
            guild_id: GUILD_ID,
            content,
            author: { id: "human" },
          },
        })
      );
    }

    expect(state.stored?.lastSeq).toBe(203);
    // The write-avoidance that was worth keeping: no upstream calls and no
    // cross-DO idle-clock write for a channel this bot does not serve.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(feed.applied).toHaveLength(0);
  });

  it("RESUMEs from the last frame seen, not the last one answered", async () => {
    const state = createFakeState();
    state.seed({
      wsState: "live",
      selfUserId: "bot-id",
      sessionId: "sess",
      resumeUrl: "wss://resume.example",
      // Where the last answered lookup left it, hours ago.
      lastSeq: 200,
    });
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env()
    );
    denyFetch();

    await doInstance.handleSocketMessage(
      createFakeSocket() as unknown as WebSocket,
      frame({
        op: 0,
        s: 986,
        t: "MESSAGE_CREATE",
        d: {
          id: "m1",
          channel_id: TRADING_FLOOR_CHANNEL_ID,
          guild_id: GUILD_ID,
          content: "gm",
          author: { id: "human" },
        },
      })
    );

    // The socket drops and comes back.
    const reopened = createFakeSocket();
    await doInstance.handleSocketMessage(
      reopened as unknown as WebSocket,
      frame({ op: 10, d: { heartbeat_interval: 41_250 } })
    );

    const resume = reopened.sent[0] as {
      op: number;
      d: { session_id: string; seq: number };
    };
    expect(resume.op).toBe(6);
    expect(resume.d.session_id).toBe("sess");
    // Asking for 200 replays hundreds of frames, answers the old lookup a
    // second time (nothing dedupes by message id), and risks an op=9 and a
    // full re-IDENTIFY.
    expect(resume.d.seq).toBe(986);
  });

  it("keeps the sequence out of the lookup path's way when a reply fails", async () => {
    const state = createFakeState();
    state.seed({ wsState: "live", selfUserId: "bot-id", lastSeq: 10 });
    const doInstance = new GatewayDO(
      state as unknown as DurableObjectState,
      env()
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("upstream down"));

    await doInstance.handleSocketMessage(
      createFakeSocket() as unknown as WebSocket,
      frame({
        op: 0,
        s: 11,
        t: "MESSAGE_CREATE",
        d: {
          id: "m1",
          channel_id: GENERAL_CHANNEL_ID,
          guild_id: GUILD_ID,
          content: "b#1",
          author: { id: "human" },
        },
      })
    );

    // The sequence is recorded before the lookup runs, so an upstream failure
    // cannot cost the resume point.
    expect(state.stored?.lastSeq).toBe(11);
  });
});
