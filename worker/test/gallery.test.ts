/**
 * The `#gallery` cron.
 *
 * Since the idle work landed this channel has two things to get right, and the
 * second is the one that would go unnoticed: it must not post into a server
 * that is awake, and its rotation must survive being gated. The rotation used
 * to come from six-hour wall clock buckets, which alternates correctly only
 * while the cron posts on every tick. Gated to one post a day, consecutive
 * posts land four buckets apart, the same parity every time, and the channel
 * would have shown bots and nothing else forever.
 */

import { describe, expect, it, vi } from "vitest";
import { postGalleryItem } from "../src/channels/gallery";
import { nextGalleryKind } from "../src/channels/idle";
import { createMemoryPoster } from "./fixtures";
import {
  createMemoryIdleStore,
  DAY_MS,
  HOUR_MS,
  idleState,
  NOW,
} from "./idle-fixtures";
import { createLookupArtifact, createLookupClients } from "./lookup-fixtures";

/** A store whose guild last spoke `hours` ago. */
const quietFor = (hours: number) =>
  createMemoryIdleStore(
    idleState({ lastHumanMessageAtMs: NOW - hours * HOUR_MS })
  );

describe("the rotation", () => {
  it("alternates from what was posted last, not from the clock", () => {
    expect(nextGalleryKind(null)).toBe("bot");
    expect(nextGalleryKind("bot")).toBe("artifact");
    expect(nextGalleryKind("artifact")).toBe("bot");
  });
});

describe("the idle gate", () => {
  it("posts nothing while the guild is awake", async () => {
    const fake = createLookupClients();
    const poster = createMemoryPoster();
    const store = quietFor(3);

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store,
      now: () => NOW,
      randomInt: () => 1234,
    });

    expect(outcome).toBe("not-quiet");
    expect(poster.sends).toHaveLength(0);
    expect(fake.subrequests).toBe(0);
  });

  it("posts nothing on a cold start, it seeds instead", async () => {
    const fake = createLookupClients();
    const poster = createMemoryPoster();
    const store = createMemoryIdleStore(null);

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store,
      now: () => NOW,
      randomInt: () => 1234,
    });

    expect(outcome).toBe("seeded");
    expect(poster.sends).toHaveLength(0);
    expect(store.current?.lastHumanMessageAtMs).toBe(NOW);
  });

  it("holds the four daily ticks down to one post", async () => {
    const fake = createLookupClients();
    const store = quietFor(48);
    const outcomes: string[] = [];

    // The cron fires at 0, 6, 12 and 18 hours. Only the first should land.
    for (const hours of [0, 6, 12, 18]) {
      const poster = createMemoryPoster();
      outcomes.push(
        await postGalleryItem({
          clients: fake.clients,
          poster,
          store,
          now: () => NOW + hours * HOUR_MS,
          randomInt: () => 1234,
        })
      );
    }

    expect(outcomes).toEqual([
      "posted",
      "cooling-down",
      "cooling-down",
      "cooling-down",
    ]);
  });

  it("alternates across consecutive days rather than repeating", async () => {
    const fake = createLookupClients({
      recentArtifacts: [createLookupArtifact(5)],
      artifacts: { 5: createLookupArtifact(5) },
    });
    const store = quietFor(48);
    const kinds: (string | null | undefined)[] = [];

    for (let day = 0; day < 3; day++) {
      await postGalleryItem({
        clients: fake.clients,
        poster: createMemoryPoster(),
        store,
        now: () => NOW + day * DAY_MS,
        randomInt: () => 1,
      });
      kinds.push(store.current?.lastGalleryKind);
    }

    expect(kinds).toEqual(["bot", "artifact", "bot"]);
  });
});

describe("one gallery tick", () => {
  it("posts a random bot when it is the bot's turn", async () => {
    const fake = createLookupClients();
    const poster = createMemoryPoster();

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store: quietFor(48),
      now: () => NOW,
      randomInt: () => 1234,
    });

    expect(outcome).toBe("posted");
    expect(poster.sends).toHaveLength(1);
    const [body] = poster.sends as Array<{ embeds: { title?: string }[] }>;
    expect(body?.embeds[0]?.title).toBe("GlyphBot #1234");
  });

  it("posts a random artifact when it is the artifact's turn", async () => {
    const fake = createLookupClients({
      recentArtifacts: [createLookupArtifact(5)],
      artifacts: { 5: createLookupArtifact(5) },
    });
    const poster = createMemoryPoster();
    const store = createMemoryIdleStore(
      idleState({
        lastHumanMessageAtMs: NOW - 48 * HOUR_MS,
        lastGalleryAtMs: NOW - 25 * HOUR_MS,
        lastGalleryKind: "bot",
      })
    );

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store,
      now: () => NOW,
      randomInt: () => 1,
    });

    expect(outcome).toBe("posted");
    const [body] = poster.sends as Array<{ embeds: { title?: string }[] }>;
    expect(body?.embeds[0]?.title).toBe("Artifact 5");
  });

  it("retries a miss and gives up quietly", async () => {
    const fake = createLookupClients({ bots: {} });
    const poster = createMemoryPoster();

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store: quietFor(48),
      now: () => NOW,
      randomInt: () => 1,
    });

    expect(outcome).toBe("no-content");
    expect(poster.sends).toHaveLength(0);
    // Three attempts, two calls each (the bot and the OpenSea read).
    expect(fake.fetchBot).toHaveBeenCalledTimes(3);
  });

  it("posts nothing when there are no minted artifacts", async () => {
    const fake = createLookupClients({ recentArtifacts: [] });
    const poster = createMemoryPoster();
    const store = createMemoryIdleStore(
      idleState({
        lastHumanMessageAtMs: NOW - 48 * HOUR_MS,
        lastGalleryAtMs: NOW - 25 * HOUR_MS,
        lastGalleryKind: "bot",
      })
    );

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store,
      now: () => NOW,
      randomInt: () => 1,
    });

    expect(outcome).toBe("no-content");
    expect(poster.sends).toHaveLength(0);
  });

  it("spends the rest of its attempts when a build throws", async () => {
    // The retry loop is there because a random pick can be a burned bot or an
    // artifact the embed builders reject. Returning out of the catch spent the
    // whole three-attempt budget on the first bad draw.
    const fake = createLookupClients();
    fake.fetchBot.mockRejectedValueOnce(new Error("glyphbots 500"));
    const poster = createMemoryPoster();

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store: quietFor(48),
      now: () => NOW,
      randomInt: () => 1234,
    });

    expect(outcome).toBe("posted");
    expect(poster.sends).toHaveLength(1);
    expect(fake.fetchBot).toHaveBeenCalledTimes(2);
  });

  it("gives up after three throwing attempts, without posting", async () => {
    const fake = createLookupClients();
    fake.fetchBot.mockRejectedValue(new Error("glyphbots 500"));
    const poster = createMemoryPoster();
    const store = quietFor(48);

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store,
      now: () => NOW,
      randomInt: () => 1234,
    });

    expect(outcome).toBe("no-content");
    expect(poster.sends).toHaveLength(0);
    expect(fake.fetchBot).toHaveBeenCalledTimes(3);
    expect(store.current?.lastGalleryAtMs).toBeNull();
  });

  it("does not buy a day of silence when the send fails", async () => {
    const fake = createLookupClients();
    const store = quietFor(48);
    const poster = {
      send: vi.fn(() => Promise.reject(new Error("500"))),
    };

    const outcome = await postGalleryItem({
      clients: fake.clients,
      poster,
      store,
      now: () => NOW,
      randomInt: () => 1,
    });

    expect(outcome).toBe("send-failed");
    expect(store.current?.lastGalleryAtMs).toBeNull();
  });
});
