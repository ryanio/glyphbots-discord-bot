/**
 * The idle nudge.
 *
 * The interesting cases are all about time and about who is allowed to move the
 * clock, so nothing here touches a network or a real `Date.now()`. Every test
 * drives `runIdleNudge` with an injected clock and the in-memory store from
 * `idle-fixtures.ts`, which serializes on both sides exactly like the Durable
 * Object does.
 *
 * The one that would be easiest to get wrong, and is therefore worth naming: a
 * nudge posts into `#general` and comes straight back as a `MESSAGE_CREATE`. If
 * that reset the clock the bot would nudge once and never again. It is covered
 * twice below, once through `isHumanActivity` and once through the record the
 * update actually writes.
 */

import { describe, expect, it } from "vitest";
import {
  applyIdleUpdate,
  decideNudge,
  type IdleState,
  type IdleUpdate,
  isHumanActivity,
  NUDGE_KINDS,
  nextNudgeKind,
} from "../src/channels/idle";
import { runIdleNudge } from "../src/channels/nudge";
import { collectionFacts } from "../src/channels/nudge-content";
import { GENERAL_CHANNEL_ID, GUILD_ID, MAX_BOT_TOKEN_ID } from "../src/config";
import type { LookupMessage } from "../src/lookups/handle";
import {
  createArtifact,
  createFeedStateDO,
  createMemoryPoster,
  firstEmbed,
} from "./fixtures";
import {
  createMemoryIdleStore,
  DAY_MS,
  HOUR_MS,
  idleState,
  NOW,
} from "./idle-fixtures";
import { createLookupClients } from "./lookup-fixtures";

const SELF_ID = "oracle-bot";

/** OpenSea stats with enough in them for at least one fact. */
const STATS = {
  total: {
    volume: 812.5,
    sales: 640,
    num_owners: 311,
    market_cap: 900,
    floor_price: 0.042,
    floor_price_symbol: "ETH",
    average_price: 1.27,
  },
  intervals: [],
};

/** Clients where every one of the four kinds has something to say. */
const richClients = () =>
  createLookupClients({
    recentArtifacts: [createArtifact({ contractTokenId: 5 })],
    artifacts: { 5: createArtifact({ contractTokenId: 5 }) },
    collectionStats: STATS,
    artifactSummary: { total: 173, last1d: 0, last7d: 2, last30d: 2 },
  });

/** Deps with everything random pinned, so a test asserts one exact message. */
const nudgeDeps = (
  store: ReturnType<typeof createMemoryIdleStore>,
  options: {
    now?: number;
    clients?: ReturnType<typeof createLookupClients>;
    poster?: ReturnType<typeof createMemoryPoster>;
  } = {}
) => {
  const clients = options.clients ?? createLookupClients();
  const poster = options.poster ?? createMemoryPoster();
  return {
    deps: {
      clients: clients.clients,
      poster,
      store,
      now: () => options.now ?? NOW,
      randomInt: (max: number) => Math.min(1234, max),
      pick: <T>(items: readonly T[]): T | undefined => items[0],
    },
    clients,
    poster,
  };
};

const humanMessage = (
  overrides: Partial<LookupMessage> = {}
): LookupMessage => ({
  id: "m1",
  channel_id: GENERAL_CHANNEL_ID,
  guild_id: GUILD_ID,
  content: "morning",
  author: { id: "someone" },
  ...overrides,
});

describe("what counts as the server being awake", () => {
  it("takes a human message in #general", () => {
    expect(isHumanActivity(humanMessage(), SELF_ID)).toBe(true);
  });

  it("ignores the bot's own nudge, which is the whole point", () => {
    expect(
      isHumanActivity(humanMessage({ author: { id: SELF_ID } }), SELF_ID)
    ).toBe(false);
    expect(
      isHumanActivity(
        humanMessage({ author: { id: "other-bot", bot: true } }),
        SELF_ID
      )
    ).toBe(false);
  });

  it("ignores other channels, other guilds and DMs", () => {
    expect(
      isHumanActivity(
        humanMessage({ channel_id: "1446247601942036574" }),
        SELF_ID
      )
    ).toBe(false);
    expect(isHumanActivity(humanMessage({ guild_id: "999" }), SELF_ID)).toBe(
      false
    );
    const dm = humanMessage();
    delete (dm as { guild_id?: string }).guild_id;
    expect(isHumanActivity(dm, SELF_ID)).toBe(false);
  });
});

describe("the clock and the cooldown", () => {
  it("stays quiet under the threshold", () => {
    const state = idleState({ lastHumanMessageAtMs: NOW - 47 * HOUR_MS });
    expect(decideNudge(state, NOW)).toEqual({
      post: false,
      reason: "not-quiet",
    });
  });

  it("fires at the threshold", () => {
    const state = idleState({ lastHumanMessageAtMs: NOW - 48 * HOUR_MS });
    expect(decideNudge(state, NOW)).toEqual({ post: true, kind: "bot" });
  });

  it("holds off inside the cooldown even while the silence runs on", () => {
    const state = idleState({
      lastHumanMessageAtMs: NOW - 10 * DAY_MS,
      lastNudgeAtMs: NOW - 23 * HOUR_MS,
      lastNudgeKind: "bot",
    });
    expect(decideNudge(state, NOW)).toEqual({
      post: false,
      reason: "cooling-down",
    });
  });

  it("fires again a day later", () => {
    const state = idleState({
      lastHumanMessageAtMs: NOW - 10 * DAY_MS,
      lastNudgeAtMs: NOW - 24 * HOUR_MS,
      lastNudgeKind: "bot",
    });
    expect(decideNudge(state, NOW)).toEqual({ post: true, kind: "artifact" });
  });

  it("does not read an unset clock as infinite silence", () => {
    // `runIdleNudge` seeds before it ever gets here, so this is the floor under
    // that rather than a path anything takes. It matters which way the floor
    // falls: read as "silent since the epoch", a fresh record would fire on the
    // first check after every deploy.
    expect(decideNudge(idleState(), NOW)).toEqual({
      post: false,
      reason: "not-quiet",
    });
  });
});

describe("the rotation", () => {
  it("never repeats a kind back to back", () => {
    let previous: (typeof NUDGE_KINDS)[number] | null = null;
    const seen: string[] = [];

    for (let step = 0; step < NUDGE_KINDS.length * 3; step++) {
      const kind = nextNudgeKind(previous);
      expect(kind).not.toBe(previous);
      seen.push(kind);
      previous = kind;
    }

    // And it is a rotation, not a shuffle that happens to avoid repeats: every
    // kind appears three times in twelve steps.
    for (const kind of NUDGE_KINDS) {
      expect(seen.filter((entry) => entry === kind)).toHaveLength(3);
    }
  });

  it("starts at the first kind from a blank record", () => {
    expect(nextNudgeKind(null)).toBe("bot");
  });
});

describe("one idle check", () => {
  it("posts nothing and seeds the clock on a cold start", async () => {
    const store = createMemoryIdleStore(null);
    const { deps, poster } = nudgeDeps(store);

    expect(await runIdleNudge(deps)).toBe("seeded");
    expect(poster.sends).toHaveLength(0);
    expect(store.current?.lastHumanMessageAtMs).toBe(NOW);
    expect(store.current?.lastNudgeAtMs).toBeNull();
  });

  it("still posts nothing on the tick right after seeding", async () => {
    const store = createMemoryIdleStore(null);

    await runIdleNudge(nudgeDeps(store, { now: NOW }).deps);
    const second = nudgeDeps(store, { now: NOW + HOUR_MS });

    expect(await runIdleNudge(second.deps)).toBe("not-quiet");
    expect(second.poster.sends).toHaveLength(0);
  });

  it("posts nothing when the guild spoke yesterday", async () => {
    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 30 * HOUR_MS })
    );
    const { deps, poster, clients } = nudgeDeps(store);

    expect(await runIdleNudge(deps)).toBe("not-quiet");
    expect(poster.sends).toHaveLength(0);
    // And it spent nothing finding that out.
    expect(clients.subrequests).toBe(0);
  });

  it("posts once after two days of silence", async () => {
    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 49 * HOUR_MS })
    );
    const { deps, poster } = nudgeDeps(store);

    expect(await runIdleNudge(deps)).toBe("posted");
    expect(poster.sends).toHaveLength(1);

    expect(firstEmbed(poster.sends[0]).title).toBe("GlyphBot #1234");
    expect(store.current?.lastNudgeAtMs).toBe(NOW);
    expect(store.current?.lastNudgeKind).toBe("bot");
  });

  it("posts nothing on the next hourly check, inside the cooldown", async () => {
    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 49 * HOUR_MS })
    );

    await runIdleNudge(nudgeDeps(store, { now: NOW }).deps);
    const second = nudgeDeps(store, { now: NOW + HOUR_MS });

    expect(await runIdleNudge(second.deps)).toBe("cooling-down");
    expect(second.poster.sends).toHaveLength(0);
  });

  it("goes quiet again the moment a human speaks", async () => {
    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 49 * HOUR_MS })
    );

    // Somebody says something, which is what the gateway writes through.
    await store.apply({ op: "human-message", atMs: NOW });

    const { deps, poster } = nudgeDeps(store, { now: NOW + HOUR_MS });
    expect(await runIdleNudge(deps)).toBe("not-quiet");
    expect(poster.sends).toHaveLength(0);

    // And the suppression lasts a full 48 hours from the message, not from the
    // check that noticed it.
    const later = nudgeDeps(store, { now: NOW + 47 * HOUR_MS });
    expect(await runIdleNudge(later.deps)).toBe("not-quiet");
  });

  it("does not reset its own clock by posting", async () => {
    const spokeAt = NOW - 49 * HOUR_MS;
    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: spokeAt })
    );
    const clients = richClients();

    await runIdleNudge(nudgeDeps(store, { now: NOW, clients }).deps);

    // The nudge write touches the nudge fields and nothing else. If a bot post
    // could move `lastHumanMessageAtMs` the cooldown would be the only guard
    // left and the bot would fall silent after one post.
    expect(store.current?.lastHumanMessageAtMs).toBe(spokeAt);

    const nextDay = nudgeDeps(store, { now: NOW + 24 * HOUR_MS, clients });
    expect(await runIdleNudge(nextDay.deps)).toBe("posted");
  });

  it("rotates rather than repeating over consecutive days", async () => {
    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 49 * HOUR_MS })
    );
    const clients = richClients();

    const kinds: string[] = [];
    for (let day = 0; day < 4; day++) {
      const poster = createMemoryPoster();
      const { deps } = nudgeDeps(store, {
        now: NOW + day * DAY_MS,
        clients,
        poster,
      });
      expect(await runIdleNudge(deps)).toBe("posted");
      kinds.push(store.current?.lastNudgeKind ?? "");
    }

    expect(kinds).toEqual(["bot", "artifact", "stat", "notable"]);
    for (let i = 1; i < kinds.length; i++) {
      expect(kinds[i]).not.toBe(kinds[i - 1]);
    }
  });

  it("falls through to the next kind when the first has nothing", async () => {
    // No artifacts have been minted, so the artifact kind cannot build.
    const clients = createLookupClients({
      recentArtifacts: [],
      collectionStats: STATS,
    });
    const store = createMemoryIdleStore(
      idleState({
        lastHumanMessageAtMs: NOW - 49 * HOUR_MS,
        lastNudgeAtMs: NOW - 25 * HOUR_MS,
        lastNudgeKind: "bot",
      })
    );
    const { deps, poster } = nudgeDeps(store, { clients });

    expect(await runIdleNudge(deps)).toBe("posted");
    expect(poster.sends).toHaveLength(1);
    // "stat" is the next kind along from "artifact", and it has stats to read.
    expect(store.current?.lastNudgeKind).toBe("stat");
  });

  it("falls through to the next kind when the first one throws", async () => {
    // Two ways `buildNudgePost` throws and neither is exotic: the embed
    // builders validate at call time, and `nudge-content.ts` wraps none of its
    // API calls. Unwrapped, the throw abandoned the tick and the fallback
    // kind, which exists for exactly this, was never reached.
    const clients = createLookupClients({
      recentArtifacts: [createArtifact({ contractTokenId: 5 })],
      artifacts: { 5: createArtifact({ contractTokenId: 5 }) },
    });
    clients.fetchBot.mockRejectedValueOnce(new Error("glyphbots 500"));

    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 49 * HOUR_MS })
    );
    const { deps, poster } = nudgeDeps(store, { clients });

    expect(await runIdleNudge(deps)).toBe("posted");
    expect(poster.sends).toHaveLength(1);
    // "bot" was the kind due and it threw; "artifact" is next along.
    expect(store.current?.lastNudgeKind).toBe("artifact");
  });

  it("gives up quietly when both kinds throw", async () => {
    const clients = createLookupClients();
    clients.fetchBot.mockRejectedValue(new Error("glyphbots 500"));
    clients.fetchRecentArtifacts.mockRejectedValue(new Error("glyphbots 500"));

    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 49 * HOUR_MS })
    );
    const { deps, poster } = nudgeDeps(store, { clients });

    expect(await runIdleNudge(deps)).toBe("no-content");
    expect(poster.sends).toHaveLength(0);
    // Nothing was posted, so no cooldown was bought and the next hourly check
    // tries again.
    expect(store.current?.lastNudgeAtMs).toBeNull();
  });

  it("records nothing when Discord rejects the post", async () => {
    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 49 * HOUR_MS })
    );
    const poster = createMemoryPoster({ failWith: new Error("500") });
    const clients = createLookupClients();

    const outcome = await runIdleNudge({
      clients: clients.clients,
      poster,
      store,
      now: () => NOW,
      randomInt: () => 1234,
      pick: <T>(items: readonly T[]): T | undefined => items[0],
    });

    expect(outcome).toBe("send-failed");
    // No cooldown was bought, so the next check tries again rather than
    // waiting a day for a message nobody saw.
    expect(store.current?.lastNudgeAtMs).toBeNull();
  });

  it("survives a round trip through storage", async () => {
    const store = createMemoryIdleStore(
      idleState({ lastHumanMessageAtMs: NOW - 49 * HOUR_MS })
    );

    await runIdleNudge(nudgeDeps(store, { now: NOW }).deps);

    // Rebuild the store from what was serialized, the way a redeploy would.
    const revived = createMemoryIdleStore(store.current);
    const { deps, poster } = nudgeDeps(revived, { now: NOW + HOUR_MS });

    expect(await runIdleNudge(deps)).toBe("cooling-down");
    expect(poster.sends).toHaveLength(0);
    expect(revived.current?.lastNudgeKind).toBe("bot");
  });
});

describe("the record itself", () => {
  it("never lets a seed overwrite a clock that already exists", () => {
    const existing = idleState({ lastHumanMessageAtMs: NOW });
    expect(
      applyIdleUpdate(existing, { op: "seed", atMs: NOW + DAY_MS })
    ).toEqual(existing);
  });

  it("never winds the clock backwards on an out-of-order message", () => {
    const state = idleState({ lastHumanMessageAtMs: NOW });
    expect(
      applyIdleUpdate(state, { op: "human-message", atMs: NOW - HOUR_MS })
        .lastHumanMessageAtMs
    ).toBe(NOW);
  });

  it("keeps the two clocks separate", () => {
    const after = applyIdleUpdate(idleState({ lastHumanMessageAtMs: NOW }), {
      op: "nudge",
      atMs: NOW + DAY_MS,
      kind: "stat",
    });
    expect(after.lastHumanMessageAtMs).toBe(NOW);
    expect(after.lastNudgeAtMs).toBe(NOW + DAY_MS);
    expect(after.lastGalleryAtMs).toBeNull();
  });
});

/**
 * The record's real home, driven through `FeedStateDO.fetch` rather than the
 * in-memory stand-in, so the JSON hop, the validator and `applyIdleUpdate` are
 * all on the path. This is the part a test with a shared object reference would
 * pass without exercising.
 */
describe("the idle record inside FeedStateDO", () => {
  const read = (feed: ReturnType<typeof createFeedStateDO>) =>
    feed.read<IdleState>("idle-state");

  const apply = (
    feed: ReturnType<typeof createFeedStateDO>,
    update: IdleUpdate
  ) => feed.apply("idle-state", update);

  it("reads as absent before anything is written", async () => {
    expect(await read(createFeedStateDO())).toBeNull();
  });

  it("round-trips a full record through storage", async () => {
    const feed = createFeedStateDO();

    await apply(feed, { op: "seed", atMs: NOW - 3 * DAY_MS });
    await apply(feed, { op: "nudge", atMs: NOW - DAY_MS, kind: "notable" });
    await apply(feed, { op: "gallery", atMs: NOW, kind: "artifact" });

    expect(await read(feed)).toEqual({
      lastHumanMessageAtMs: NOW - 3 * DAY_MS,
      lastNudgeAtMs: NOW - DAY_MS,
      lastNudgeKind: "notable",
      lastGalleryAtMs: NOW,
      lastGalleryKind: "artifact",
    });
  });

  it("merges a message and a nudge that arrive from different callers", async () => {
    const feed = createFeedStateDO();

    await apply(feed, { op: "seed", atMs: NOW - 3 * DAY_MS });
    await apply(feed, { op: "nudge", atMs: NOW - DAY_MS, kind: "bot" });
    await apply(feed, { op: "human-message", atMs: NOW });

    const state = await read(feed);
    expect(state?.lastHumanMessageAtMs).toBe(NOW);
    expect(state?.lastNudgeAtMs).toBe(NOW - DAY_MS);
  });

  it("rejects an operation it does not recognize", async () => {
    const feed = createFeedStateDO();
    const bad = await feed.apply("idle-state", { op: "wipe", atMs: NOW });

    expect(bad.status).toBe(400);
    expect(await read(feed)).toBeNull();
  });

  it("rejects a nudge carrying a kind that is not in the rotation", async () => {
    const feed = createFeedStateDO();
    const bad = await feed.apply("idle-state", {
      op: "nudge",
      atMs: NOW,
      kind: "haiku",
    });
    expect(bad.status).toBe(400);
  });

  it("treats a corrupt stored record as absent rather than as silence", async () => {
    const feed = createFeedStateDO({
      idleState: { lastHumanMessageAtMs: "ages ago" },
    });

    // Absent, not "silent since the epoch", so the next tick seeds instead of
    // firing.
    expect(await read(feed)).toBeNull();
  });

  it("answers 404 for a record it does not have and 405 for a write it does not take", async () => {
    const feed = createFeedStateDO();

    expect((await feed.request("nope", "GET")).status).toBe(404);
    expect((await feed.request("idle-state", "PUT")).status).toBe(405);
  });
});

describe("the collection facts", () => {
  const stats = {
    ...STATS,
    intervals: [
      {
        interval: "one_day",
        volume: 0,
        volume_diff: 0,
        volume_change: 0,
        sales: 0,
        sales_diff: 0,
        average_price: 0,
      },
      {
        interval: "seven_day",
        volume: 3.5,
        volume_diff: 0,
        volume_change: 0,
        sales: 4,
        sales_diff: 0,
        average_price: 0.875,
      },
    ],
  };

  it("offers several distinct phrasings, so it does not read the same twice", () => {
    const facts = collectionFacts(stats, {
      total: 173,
      last1d: 0,
      last7d: 2,
      last30d: 2,
    });

    expect(facts.length).toBeGreaterThanOrEqual(6);
    expect(new Set(facts.map((fact) => fact.text)).size).toBe(facts.length);
  });

  it("drops the empty intervals rather than announcing a zero", () => {
    const texts = collectionFacts(stats, null).map((fact) => fact.text);
    expect(texts.some((text) => text.includes("last 24 hours"))).toBe(false);
    expect(texts.some((text) => text.includes("last seven days"))).toBe(true);
  });

  it("will not quote a floor denominated in something other than ETH", () => {
    const inWeth = {
      ...stats,
      total: { ...stats.total, floor_price_symbol: "WETH" },
    };
    const texts = collectionFacts(inWeth, null).map((fact) => fact.text);
    expect(texts.some((text) => text.includes("floor"))).toBe(false);
    // The facts that do not involve a price are still on offer.
    expect(texts.some((text) => text.includes("wallets hold"))).toBe(true);
  });

  it("attributes each fact to the API it came from", () => {
    const facts = collectionFacts(null, {
      total: 173,
      last1d: 1,
      last7d: 2,
      last30d: 2,
    });
    expect(facts.every((fact) => fact.source === "glyphbots.com")).toBe(true);
    expect(facts.some((fact) => fact.text.includes("**1** artifact "))).toBe(
      true
    );
  });

  it("has nothing to say when both sources are down", () => {
    expect(collectionFacts(null, null)).toEqual([]);
  });

  it("quotes the supply as the supply", () => {
    const facts = collectionFacts(stats, null);
    const owners = facts.find((fact) => fact.text.includes("wallets hold"));
    expect(owners?.text).toContain(MAX_BOT_TOKEN_ID.toLocaleString());
  });
});
