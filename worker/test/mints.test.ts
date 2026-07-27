/**
 * Behavioral coverage ported from `test/channels/mints.test.ts` on the Node
 * bot. The Node suite drives `initMintsChannel` with a mocked discord.js
 * client; here the same cases drive `pollMints` with an in-memory cursor store
 * and a recording poster, because a cron tick is one poll and there is no
 * client to mock.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MintsCursorState } from "../src/channels/mints";
import {
  advanceCursor,
  applyMintCursorUpdate,
  pollMints,
  selectNewMints,
  toMintRecords,
} from "../src/channels/mints";
import { ARTIFACTS_CONTRACT } from "../src/config";
import {
  contentSends,
  createApi,
  createArtifact,
  createFeedStateDO,
  createMemoryPoster,
  createMemoryStore,
  cursor,
  embedSends,
  firstEmbed,
  mintedArtifact,
  mintPollDeps,
} from "./fixtures";

/** The first embed across every send that carries one. */
const firstEmbedSend = (sends: Parameters<typeof embedSends>[0]) =>
  firstEmbed(embedSends(sends)[0]);

describe("cold start", () => {
  it("seeds the cursor and posts nothing", async () => {
    const api = createApi([
      mintedArtifact("a", "2025-01-01T00:00:00Z", 1),
      mintedArtifact("b", "2025-01-02T00:00:00Z", 2),
      mintedArtifact("c", "2025-01-03T00:00:00Z", 3),
    ]);
    const poster = createMemoryPoster();
    const store = createMemoryStore(null);

    await pollMints(mintPollDeps(api, poster, store));

    expect(poster.sends).toHaveLength(0);
    expect(store.current).toEqual({
      lastMintedAtMs: new Date("2025-01-03T00:00:00Z").getTime(),
      postedArtifactIds: ["a", "b", "c"],
    });
  });

  it("ignores unminted artifacts when seeding", async () => {
    const api = createApi([
      mintedArtifact("real", "2025-01-01T00:00:00Z", 1),
      createArtifact({ id: "pending", mintedAt: null, contractTokenId: null }),
    ]);
    const store = createMemoryStore(null);

    await pollMints(mintPollDeps(api, createMemoryPoster(), store));

    expect(store.current).toEqual({
      lastMintedAtMs: new Date("2025-01-01T00:00:00Z").getTime(),
      postedArtifactIds: ["real"],
    });
  });
});

describe("new mint detection", () => {
  it("posts a newly detected mint exactly once", async () => {
    const api = createApi([
      mintedArtifact("new-1", "2025-06-01T00:00:00Z", 10),
    ]);
    const poster = createMemoryPoster();
    const store = createMemoryStore(cursor(0));

    const posted = await pollMints(mintPollDeps(api, poster, store));

    expect(posted).toBe(1);
    expect(embedSends(poster.sends)).toHaveLength(1);
    expect(store.current?.postedArtifactIds).toEqual(["new-1"]);
  });

  it("posts oldest first so the channel reads chronologically", async () => {
    const api = createApi([
      mintedArtifact("newest", "2025-06-03T00:00:00Z", 12),
      mintedArtifact("oldest", "2025-06-01T00:00:00Z", 10),
      mintedArtifact("middle", "2025-06-02T00:00:00Z", 11),
    ]);
    const poster = createMemoryPoster();
    const store = createMemoryStore(cursor(0));

    await pollMints(mintPollDeps(api, poster, store));

    expect(store.current?.postedArtifactIds).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
  });

  it("does not repost the same artifact on a second poll", async () => {
    const api = createApi([mintedArtifact("dupe", "2025-06-01T00:00:00Z", 10)]);
    const poster = createMemoryPoster();
    const store = createMemoryStore(cursor(0));

    await pollMints(mintPollDeps(api, poster, store));
    expect(embedSends(poster.sends)).toHaveLength(1);

    // Second tick, identical API payload. The inclusive timestamp re-surfaces
    // the artifact; the id set is what rejects it.
    await pollMints(mintPollDeps(api, poster, store));

    expect(embedSends(poster.sends)).toHaveLength(1);
    expect(store.current?.postedArtifactIds).toContain("dupe");
  });

  it("posts nothing and does not seed when the API returns no artifacts", async () => {
    const poster = createMemoryPoster();
    const cold = createMemoryStore(null);

    await pollMints(mintPollDeps(createApi([]), poster, cold));

    expect(poster.sends).toHaveLength(0);
    // The empty-artifacts guard runs before the cursor is even read, and a
    // cold store is what makes that visible. Without the guard an empty
    // response seeds the cursor to "nothing minted yet", and the next response
    // that does carry artifacts has no floor to diff against, so the whole
    // backlog posts.
    expect(cold.updates).toHaveLength(0);
    expect(cold.current).toBeNull();

    const warm = createMemoryStore(cursor(0));
    await pollMints(mintPollDeps(createApi([]), poster, warm));
    expect(warm.updates).toHaveLength(0);
  });
});

describe("unminted artifacts", () => {
  it("ignores artifacts with a null mintedAt", async () => {
    const api = createApi([
      createArtifact({ id: "unminted", mintedAt: null, contractTokenId: 5 }),
    ]);
    const poster = createMemoryPoster();

    await pollMints(mintPollDeps(api, poster, createMemoryStore(cursor(0))));

    expect(poster.sends).toHaveLength(0);
  });

  it("ignores artifacts with a null contractTokenId", async () => {
    const api = createApi([
      createArtifact({
        id: "no-token",
        mintedAt: "2025-06-01T00:00:00Z",
        contractTokenId: null,
      }),
    ]);
    const poster = createMemoryPoster();

    await pollMints(mintPollDeps(api, poster, createMemoryStore(cursor(0))));

    expect(poster.sends).toHaveLength(0);
  });
});

describe("burst guard", () => {
  const burst = Array.from({ length: 9 }, (_, i) =>
    mintedArtifact(
      `burst-${i}`,
      new Date(Date.UTC(2025, 5, i + 1)).toISOString(),
      100 + i
    )
  );

  it("caps individual posts and summarizes the rest", async () => {
    const poster = createMemoryPoster();

    await pollMints(
      mintPollDeps(createApi(burst), poster, createMemoryStore(cursor(0)))
    );

    expect(embedSends(poster.sends)).toHaveLength(5);
    const summaries = contentSends(poster.sends);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.content).toContain("4");
  });

  it("advances the cursor past every mint in the burst", async () => {
    const store = createMemoryStore(cursor(0));

    await pollMints(
      mintPollDeps(createApi(burst), createMemoryPoster(), store)
    );

    expect(store.current?.lastMintedAtMs).toBe(Date.UTC(2025, 5, 9));
    for (let i = 0; i < 9; i++) {
      expect(store.current?.postedArtifactIds).toContain(`burst-${i}`);
    }
  });
});

describe("embed content", () => {
  it("includes the artifact image and links", async () => {
    const artifact = mintedArtifact("embed", "2025-06-01T00:00:00Z", 77);
    const poster = createMemoryPoster();

    await pollMints(
      mintPollDeps(createApi([artifact]), poster, createMemoryStore(cursor(0)))
    );

    const embed = firstEmbedSend(poster.sends);
    expect(embed.image?.url).toBe(artifact.imageUrl);
    expect(embed.url).toBe("https://glyphbots.com/artifact/77");
    expect(embed.title).toContain("#77");
    const values = (embed.fields ?? []).map((f) => f.value).join(" ");
    expect(values).toContain(
      `https://glyphbots.com/bot/${artifact.botTokenId}`
    );
  });

  it("links the artifact on OpenSea", async () => {
    const poster = createMemoryPoster();
    const api = createApi([
      createArtifact({
        id: "os",
        mintedAt: "2025-06-01T00:00:00Z",
        contractTokenId: 88,
      }),
    ]);

    await pollMints(mintPollDeps(api, poster, createMemoryStore(cursor(0))));

    const values = (firstEmbedSend(poster.sends).fields ?? [])
      .map((f) => f.value)
      .join(" ");
    expect(values).toContain(
      `https://opensea.io/assets/ethereum/${ARTIFACTS_CONTRACT}/88`
    );
  });

  // The mint tx hash is still on the artifact record; it just has no business
  // in the embed. Nobody clicks a block explorer link for a piece of art.
  it("does not link the mint transaction on Etherscan", async () => {
    const poster = createMemoryPoster();
    const api = createApi([
      createArtifact({
        id: "tx",
        mintedAt: "2025-06-01T00:00:00Z",
        contractTokenId: 89,
        mintTxHash: "0xdeadbeef",
      }),
    ]);

    await pollMints(mintPollDeps(api, poster, createMemoryStore(cursor(0))));

    const fields = firstEmbedSend(poster.sends).fields ?? [];
    expect(fields.map((f) => f.name)).not.toContain("◉ Transaction");
    expect(
      fields
        .map((f) => f.value)
        .join(" ")
        .toLowerCase()
    ).not.toContain("etherscan");
  });
});

describe("retry on send failure", () => {
  let poster: ReturnType<typeof createMemoryPoster>;

  beforeEach(() => {
    poster = createMemoryPoster();
  });

  it("holds the cursor back so a failed mint is retried next poll", async () => {
    poster.send.mockRejectedValue(new Error("discord 500"));
    const store = createMemoryStore(cursor(1000));
    const api = createApi([mintedArtifact("boom", "2025-06-01T00:00:00Z", 1)]);

    await pollMints(mintPollDeps(api, poster, store));

    // The failed mint must not be recorded as posted, and the timestamp must
    // not move past it, otherwise it is dropped forever.
    expect(store.current?.postedArtifactIds).not.toContain("boom");
    expect(store.current?.lastMintedAtMs).toBeLessThanOrEqual(
      new Date("2025-06-01T00:00:00Z").getTime()
    );

    // Next tick with the same payload re-selects it.
    expect(
      selectNewMints(
        [mintedArtifact("boom", "2025-06-01T00:00:00Z", 1)],
        store.current ?? cursor(null)
      )
    ).toHaveLength(1);
  });

  it("keeps a successful mint recorded even when a sibling fails", async () => {
    poster.send
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new Error("discord 500")));
    const store = createMemoryStore(cursor(1000));
    const api = createApi([
      mintedArtifact("ok", "2025-06-01T00:00:00Z", 1),
      mintedArtifact("bad", "2025-06-02T00:00:00Z", 2),
    ]);

    await pollMints(mintPollDeps(api, poster, store));

    expect(store.current?.postedArtifactIds).toContain("ok");
    expect(store.current?.postedArtifactIds).not.toContain("bad");
  });

  it("does not repost the rewound successes on the next poll", async () => {
    poster.send
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new Error("discord 500")));
    const store = createMemoryStore(cursor(1000));
    const artifacts = [
      mintedArtifact("ok", "2025-06-01T00:00:00Z", 1),
      mintedArtifact("bad", "2025-06-02T00:00:00Z", 2),
    ];

    await pollMints(mintPollDeps(createApi(artifacts), poster, store));

    poster.send.mockImplementation(() => Promise.resolve());
    const retryPoster = createMemoryPoster();
    await pollMints(mintPollDeps(createApi(artifacts), retryPoster, store));

    // Only the previously failed mint goes out on the retry.
    expect(embedSends(retryPoster.sends)).toHaveLength(1);
    expect(store.current?.postedArtifactIds).toContain("bad");
  });
});

describe("an artifact the embed builders reject", () => {
  /**
   * `EmbedBuilder` validates through `@sapphire/shapeshift` at call time, so a
   * relative `imageUrl` throws out of `setImage` and an over-long title out of
   * `setTitle`. Both fields are third-party data straight off the GlyphBots
   * API, so both are reachable in production.
   */
  const bad = (id: string, mintedAt: string, tokenId: number) => ({
    ...mintedArtifact(id, mintedAt, tokenId),
    imageUrl: "/artifacts/relative.png",
  });

  it("does not throw out of the poll", async () => {
    const api = createApi([bad("bad", "2025-06-01T00:00:00Z", 1)]);

    await expect(
      pollMints(
        mintPollDeps(api, createMemoryPoster(), createMemoryStore(cursor(0)))
      )
    ).resolves.toBe(0);
  });

  it("does not stall the cursor or repost the good mint beside it", async () => {
    const good = mintedArtifact("good", "2025-06-01T00:00:00Z", 1);
    const artifacts = [good, bad("bad", "2025-06-02T00:00:00Z", 2)];
    const store = createMemoryStore(cursor(0));
    const first = createMemoryPoster();

    await pollMints(mintPollDeps(createApi(artifacts), first, store));

    // The good one went out and the cursor was written, which is the whole
    // point: built outside the try, the bad one threw all the way out of
    // `pollMints` and the write below never happened.
    expect(embedSends(first.sends)).toHaveLength(1);
    expect(store.updates).toHaveLength(1);
    expect(store.current?.postedArtifactIds).toContain("good");
    expect(store.current?.postedArtifactIds).not.toContain("bad");

    // Five minutes later, the same payload. Without the fix this is where the
    // good mint posted a second time, and it did so on every tick forever.
    const second = createMemoryPoster();
    await pollMints(mintPollDeps(createApi(artifacts), second, store));

    expect(embedSends(second.sends)).toHaveLength(0);
  });

  it("treats the failure as a failed send, so the cursor stays behind it", async () => {
    const store = createMemoryStore(cursor(0));
    const artifacts = [
      mintedArtifact("good", "2025-06-01T00:00:00Z", 1),
      bad("bad", "2025-06-02T00:00:00Z", 2),
    ];

    await pollMints(
      mintPollDeps(createApi(artifacts), createMemoryPoster(), store)
    );

    expect(store.current?.lastMintedAtMs).toBeLessThanOrEqual(
      new Date("2025-06-02T00:00:00Z").getTime()
    );
    expect(
      selectNewMints(artifacts, store.current ?? cursor(null)).map((a) => a.id)
    ).toEqual(["bad"]);
  });
});

describe("a burst summary that does not reach Discord", () => {
  const burst = Array.from({ length: 8 }, (_, i) =>
    mintedArtifact(
      `burst-${i}`,
      new Date(Date.UTC(2025, 5, i + 1)).toISOString(),
      100 + i
    )
  );

  /** Fails only the summary line, which is the send carrying `content`. */
  const summaryFails = () =>
    createMemoryPoster({
      failWith: (body) =>
        body.content === undefined ? null : new Error("discord 500"),
    });

  it("does not mark the summarized mints as posted", async () => {
    const store = createMemoryStore(cursor(0));

    await pollMints(mintPollDeps(createApi(burst), summaryFails(), store));

    // Three mints were only ever going to be represented by that one line. It
    // did not go out, so nothing has told the channel about them.
    for (const id of ["burst-0", "burst-1", "burst-2"]) {
      expect(store.current?.postedArtifactIds).not.toContain(id);
    }
    for (let i = 3; i < 8; i++) {
      expect(store.current?.postedArtifactIds).toContain(`burst-${i}`);
    }
  });

  it("holds the cursor back so they are selectable again", async () => {
    const store = createMemoryStore(cursor(0));

    await pollMints(mintPollDeps(createApi(burst), summaryFails(), store));

    expect(store.current?.lastMintedAtMs).toBeLessThanOrEqual(
      Date.UTC(2025, 5, 1)
    );
    expect(
      selectNewMints(burst, store.current ?? cursor(null)).map((a) => a.id)
    ).toEqual(["burst-0", "burst-1", "burst-2"]);
  });

  it("posts them individually on the retry", async () => {
    const store = createMemoryStore(cursor(0));

    await pollMints(mintPollDeps(createApi(burst), summaryFails(), store));

    const retry = createMemoryPoster();
    await pollMints(mintPollDeps(createApi(burst), retry, store));

    expect(embedSends(retry.sends)).toHaveLength(3);
    expect(contentSends(retry.sends)).toHaveLength(0);
    for (let i = 0; i < 8; i++) {
      expect(store.current?.postedArtifactIds).toContain(`burst-${i}`);
    }
  });

  it("still counts only the mints posted individually", async () => {
    const posted = await pollMints(
      mintPollDeps(
        createApi(burst),
        summaryFails(),
        createMemoryStore(cursor(0))
      )
    );

    expect(posted).toBe(5);
  });
});

describe("error handling", () => {
  it("does not throw when every send fails", async () => {
    const poster = createMemoryPoster();
    poster.send.mockRejectedValue(new Error("Discord API error"));
    const api = createApi([
      mintedArtifact("fails", "2025-06-01T00:00:00Z", 10),
    ]);

    await expect(
      pollMints(mintPollDeps(api, poster, createMemoryStore(cursor(0))))
    ).resolves.toBe(0);
  });

  it("propagates an API rejection to the caller's catch", async () => {
    const api = createApi([]);
    api.fetchRecentArtifacts.mockRejectedValue(new Error("network down"));

    await expect(
      pollMints(
        mintPollDeps(api, createMemoryPoster(), createMemoryStore(cursor(0)))
      )
    ).rejects.toThrow("network down");
  });
});

describe("advanceCursor", () => {
  it("caps the posted id history at 100", () => {
    const existing = Array.from({ length: 100 }, (_, i) => `old-${i}`);
    const next = advanceCursor(
      cursor(0, existing),
      toMintRecords([mintedArtifact("fresh", "2025-06-01T00:00:00Z", 1)])
    );

    expect(next.postedArtifactIds).toHaveLength(100);
    expect(next.postedArtifactIds).toContain("fresh");
    expect(next.postedArtifactIds).not.toContain("old-0");
  });

  it("never derives the timestamp from wall clock", () => {
    const mintedAt = new Date("2020-01-01T00:00:00Z").getTime();
    const next = advanceCursor(
      cursor(null),
      toMintRecords([mintedArtifact("old", "2020-01-01T00:00:00Z", 1)])
    );

    expect(next.lastMintedAtMs).toBe(mintedAt);
  });
});

describe("selectNewMints", () => {
  it("is inclusive on the boundary timestamp", () => {
    const at = new Date("2025-06-01T00:00:00Z").getTime();
    const boundary = mintedArtifact("edge", "2025-06-01T00:00:00Z", 1);

    expect(selectNewMints([boundary], cursor(at))).toHaveLength(1);
    expect(selectNewMints([boundary], cursor(at, ["edge"]))).toHaveLength(0);
  });

  it("re-admits an artifact the API reordered behind the cursor", () => {
    const backfilled = mintedArtifact("late", "2025-06-05T00:00:00Z", 2);
    const cutoff = new Date("2025-06-01T00:00:00Z").getTime();

    expect(selectNewMints([backfilled], cursor(cutoff))).toHaveLength(1);
  });
});

describe("applyMintCursorUpdate", () => {
  const record = (id: string, mintedAtMs: number) => ({ id, mintedAtMs });

  it("seeds an absent cursor", () => {
    expect(
      applyMintCursorUpdate(null, {
        op: "seed",
        handled: [record("a", 1000), record("b", 2000)],
      })
    ).toEqual({ lastMintedAtMs: 2000, postedArtifactIds: ["a", "b"] });
  });

  it("refuses to re-seed a cursor that already exists", () => {
    // Two ticks that both read `null` would otherwise both seed, and the second
    // would reset the first one's position back over mints it had posted.
    const existing = cursor(5000, ["already"]);

    expect(
      applyMintCursorUpdate(existing, {
        op: "seed",
        handled: [record("late", 1000)],
      })
    ).toEqual(existing);
  });

  it("advances and holds back in one operation", () => {
    expect(
      applyMintCursorUpdate(cursor(1000), {
        op: "advance",
        handled: [record("ok", 3000)],
        failed: [record("boom", 2000)],
      })
    ).toEqual({ lastMintedAtMs: 2000, postedArtifactIds: ["ok"] });
  });
});

describe("the mint cursor inside FeedStateDO", () => {
  const read = (feed: ReturnType<typeof createFeedStateDO>) =>
    feed.read<MintsCursorState>("mint-cursor");

  it("reads as absent before anything is written", async () => {
    expect(await read(createFeedStateDO())).toBeNull();
  });

  it("applies the merge on its own side of the input gate", async () => {
    const feed = createFeedStateDO();

    await feed.apply("mint-cursor", {
      op: "seed",
      handled: [{ id: "a", mintedAtMs: 1000 }],
    });
    await feed.apply("mint-cursor", {
      op: "advance",
      handled: [{ id: "b", mintedAtMs: 2000 }],
      failed: [],
    });

    expect(await read(feed)).toEqual({
      lastMintedAtMs: 2000,
      postedArtifactIds: ["a", "b"],
    });
  });

  it("rejects an operation it does not recognize", async () => {
    const feed = createFeedStateDO();
    const bad = await feed.apply("mint-cursor", { op: "wipe", handled: [] });

    expect(bad.status).toBe(400);
    expect(await read(feed)).toBeNull();
  });

  it("rejects a record that is not two fields of the right shape", async () => {
    const feed = createFeedStateDO();
    const bad = await feed.apply("mint-cursor", {
      op: "advance",
      handled: [{ id: 7, mintedAtMs: "soon" }],
      failed: [],
    });

    expect(bad.status).toBe(400);
  });

  it("treats a corrupt stored cursor as absent", async () => {
    const feed = createFeedStateDO({
      mintCursor: { lastMintedAtMs: "yesterday", postedArtifactIds: [] },
    });

    expect(await read(feed)).toBeNull();
  });
});

vi.mock("../src/utils/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/logger")>();
  return {
    ...actual,
    createLogger: () => ({
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    }),
  };
});
