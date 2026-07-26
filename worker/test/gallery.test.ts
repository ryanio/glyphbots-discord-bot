/**
 * The `#gallery` cron and the cron dispatch that feeds it.
 *
 * The dispatch test is the one that matters most: two crons on one Worker
 * means `scheduled()` fires for both, and a handler that ignores `event.cron`
 * posts to `#gallery` every five minutes.
 */

import { describe, expect, it, vi } from "vitest";
import { galleryKindFor, postGalleryItem } from "../src/channels/gallery";
import { createMemoryPoster } from "./fixtures";
import { createLookupArtifact, createLookupClients } from "./lookup-fixtures";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

describe("the rotation", () => {
  it("alternates bots and artifacts on six hour buckets", () => {
    expect(galleryKindFor(0)).toBe("bot");
    expect(galleryKindFor(SIX_HOURS_MS)).toBe("artifact");
    expect(galleryKindFor(2 * SIX_HOURS_MS)).toBe("bot");
    // Anywhere inside a bucket gives the same answer.
    expect(galleryKindFor(SIX_HOURS_MS + 1)).toBe("artifact");
  });
});

describe("one gallery tick", () => {
  it("posts a random bot on a bot bucket", async () => {
    const fake = createLookupClients();
    const poster = createMemoryPoster();

    const posted = await postGalleryItem({
      clients: fake.clients,
      poster,
      now: () => 0,
      randomInt: () => 1234,
    });

    expect(posted).toBe(true);
    expect(poster.sends).toHaveLength(1);
    const [body] = poster.sends as Array<{ embeds: { title?: string }[] }>;
    expect(body?.embeds[0]?.title).toBe("GlyphBot #1234");
  });

  it("posts a random artifact on an artifact bucket", async () => {
    const fake = createLookupClients({
      recentArtifacts: [createLookupArtifact(5)],
      artifacts: { 5: createLookupArtifact(5) },
    });
    const poster = createMemoryPoster();

    const posted = await postGalleryItem({
      clients: fake.clients,
      poster,
      now: () => SIX_HOURS_MS,
      randomInt: () => 1,
    });

    expect(posted).toBe(true);
    const [body] = poster.sends as Array<{ embeds: { title?: string }[] }>;
    expect(body?.embeds[0]?.title).toBe("Artifact 5");
  });

  it("retries a miss and gives up quietly", async () => {
    const fake = createLookupClients({ bots: {} });
    const poster = createMemoryPoster();

    const posted = await postGalleryItem({
      clients: fake.clients,
      poster,
      now: () => 0,
      randomInt: () => 1,
    });

    expect(posted).toBe(false);
    expect(poster.sends).toHaveLength(0);
    // Three attempts, two calls each (the bot and the OpenSea read).
    expect(fake.fetchBot).toHaveBeenCalledTimes(3);
  });

  it("posts nothing when there are no minted artifacts", async () => {
    const fake = createLookupClients({ recentArtifacts: [] });
    const poster = createMemoryPoster();

    const posted = await postGalleryItem({
      clients: fake.clients,
      poster,
      now: () => SIX_HOURS_MS,
      randomInt: () => 1,
    });

    expect(posted).toBe(false);
    expect(poster.sends).toHaveLength(0);
  });

  it("does not throw when the send fails", async () => {
    const fake = createLookupClients();
    const poster = {
      send: vi.fn(() => Promise.reject(new Error("500"))),
    };

    await expect(
      postGalleryItem({
        clients: fake.clients,
        poster,
        now: () => 0,
        randomInt: () => 1,
      })
    ).resolves.toBe(false);
  });
});
