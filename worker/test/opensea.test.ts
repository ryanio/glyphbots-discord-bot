/**
 * The OpenSea events sweep.
 *
 * Only the pagination is covered here, because that is the part with state in
 * it. `fetch` is stubbed rather than the client, so the assertions are about
 * the requests that actually go out: how many, and with which `next` cursor.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenSeaClient } from "../src/api/opensea";

/**
 * One page of `count` sale events, with `next` as its pagination cursor.
 * Newest first inside the page, which is the order the real endpoint serves.
 */
const page = (count: number, next?: string) =>
  JSON.stringify({
    asset_events: Array.from({ length: count }, (_, index) => ({
      event_type: "sale",
      event_timestamp: 1000 + count - 1 - index,
      chain: "ethereum",
      quantity: 1,
    })),
    next,
  });

/** Serves the given bodies in order, recording every URL it was asked for. */
const stubFetch = (bodies: string[]) => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      const body = bodies[urls.length - 1] ?? bodies.at(-1) ?? page(0);
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    })
  );
  return urls;
};

const nextParam = (url: string): string | null =>
  new URL(url).searchParams.get("next");

const sweep = (maxPages: number) =>
  createOpenSeaClient({}).fetchCollectionEventsSince({
    after: 0,
    eventTypes: ["sale"],
    limit: 50,
    maxPages,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the repeat-cursor guard", () => {
  it("stops on the cursor it was just given, not one page later", async () => {
    // The comment on the guard says it stops "when the API hands back the
    // cursor it was just given". Compared against the cursor from the request
    // before that, it was an A-B-A detector: it spent a third request and
    // collected the same 50 events twice.
    const urls = stubFetch([page(50, "same"), page(50, "same"), page(50, "same")]);

    const result = await sweep(10);

    expect(urls).toHaveLength(2);
    expect(nextParam(urls[0] as string)).toBeNull();
    expect(nextParam(urls[1] as string)).toBe("same");
    expect(result.events).toHaveLength(100);
    expect(result.truncated).toBe(false);
  });

  it("still follows a cursor that actually changes", async () => {
    const urls = stubFetch([
      page(50, "a"),
      page(50, "b"),
      page(10, "c"),
    ]);

    await sweep(10);

    expect(urls.map(nextParam)).toEqual([null, "a", "b"]);
  });
});

describe("the page budget", () => {
  it("reports a sweep that ran out of pages as truncated", async () => {
    // Every page is full and carries a fresh cursor, so there is always more
    // behind it. Reported as `failed: false` and nothing else, this was
    // indistinguishable from a sweep that had reached the end, and the sales
    // feed advanced its cursor past events it had never fetched.
    stubFetch([page(50, "a"), page(50, "b"), page(50, "c")]);

    const result = await sweep(3);

    expect(result.pages).toBe(3);
    expect(result.failed).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(150);
  });

  it("does not call a finished sweep truncated", async () => {
    stubFetch([page(50, "a"), page(20, "b")]);

    const result = await sweep(3);

    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("does not call a sweep truncated when the last page has no cursor", async () => {
    stubFetch([page(50, "a"), page(50, undefined)]);

    const result = await sweep(2);

    expect(result.truncated).toBe(false);
  });

  it("reports a failed page as failed rather than truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })))
    );

    const result = await sweep(3);

    expect(result.failed).toBe(true);
    expect(result.truncated).toBe(false);
  });
});

describe("ordering", () => {
  it("hands events back oldest first", async () => {
    stubFetch([page(2, undefined)]);

    const result = await sweep(3);

    expect(result.events.map((event) => event.event_timestamp)).toEqual([
      1000, 1001,
    ]);
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
