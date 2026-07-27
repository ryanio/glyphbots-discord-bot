/**
 * Inline lookup coverage: the matcher, the channel allowlist, the rate
 * limiter, and the whole message path end to end with fake clients.
 *
 * The Node bot this is ported from has no test for any of it
 * (`discord-nft-embed-bot/test` covers formatting helpers only), so these are
 * new rather than ported. They are written against the two things that can
 * hurt in production: answering somewhere it should not, and spending more
 * subrequests than a Worker invocation has.
 */

import { describe, expect, it, vi } from "vitest";
import {
  GENERAL_CHANNEL_ID,
  GUILD_ID,
  SHOW_AND_TELL_CHANNEL_ID,
} from "../src/config";
import {
  handleLookupMessage,
  isLookupChannel,
  type LookupMessage,
  type LookupReply,
} from "../src/lookups/handle";
import { parseLookups } from "../src/lookups/matcher";
import { createRateLimiter } from "../src/lookups/rate-limit";
import { createArtifact, createBot } from "./fixtures";
import { createLookupClients } from "./lookup-fixtures";

describe("the matcher", () => {
  it("reads b#123 as a bot", () => {
    expect(parseLookups("look at b#123")).toEqual([
      { kind: "bot", tokenId: 123 },
    ]);
  });

  it("reads a#7 as an artifact", () => {
    expect(parseLookups("a#7 is my favourite")).toEqual([
      { kind: "artifact", tokenId: 7 },
    ]);
  });

  it("reads a bare #123 as a bot", () => {
    expect(parseLookups("#123")).toEqual([{ kind: "bot", tokenId: 123 }]);
  });

  it("reads #username as a username", () => {
    expect(parseLookups("what does #vitalik hold")).toEqual([
      { kind: "username", username: "vitalik" },
    ]);
  });

  it("resolves #random through the injected source", () => {
    expect(parseLookups("#random", { randomInt: () => 99 })).toEqual([
      { kind: "bot", tokenId: 99 },
    ]);
  });

  it("takes every match in one message, in order", () => {
    expect(parseLookups("b#1 a#2 #ryan")).toEqual([
      { kind: "bot", tokenId: 1 },
      { kind: "artifact", tokenId: 2 },
      { kind: "username", username: "ryan" },
    ]);
  });

  it("caps a message at six matches", () => {
    const content = "b#1 b#2 b#3 b#4 b#5 b#6 b#7 b#8";
    expect(parseLookups(content, { limit: 6 })).toHaveLength(6);
  });

  it("collapses a repeated match", () => {
    expect(parseLookups("b#1 b#1 b#1")).toEqual([{ kind: "bot", tokenId: 1 }]);
  });

  it("finds nothing in ordinary conversation", () => {
    expect(parseLookups("good morning everyone")).toEqual([]);
    expect(parseLookups("issue #  1")).toEqual([]);
    expect(parseLookups("")).toEqual([]);
  });

  it("ignores a Discord channel mention", () => {
    // `<#1445933084401864767>` is how Discord writes #general in a message. The
    // Node matcher read it as a token id.
    expect(parseLookups(`see <#${GENERAL_CHANNEL_ID}>`)).toEqual([]);
  });

  it("ignores an out-of-range token id", () => {
    expect(parseLookups("b#99999")).toEqual([]);
    expect(parseLookups("b#0")).toEqual([]);
  });

  it("does not treat the random keywords as usernames", () => {
    expect(parseLookups("#rand", { randomInt: () => 5 })).toEqual([
      { kind: "bot", tokenId: 5 },
    ]);
  });
});

describe("the channel allowlist", () => {
  it("accepts #general and #show-and-tell", () => {
    expect(isLookupChannel(GENERAL_CHANNEL_ID)).toBe(true);
    expect(isLookupChannel(SHOW_AND_TELL_CHANNEL_ID)).toBe(true);
  });

  it("rejects every other channel", () => {
    // #gallery, #trading-floor, #fan-art, and a DM-shaped id.
    for (const id of [
      "1445943861263208561",
      "1446247601942036574",
      "1446248449115816230",
      "999999999999999999",
    ]) {
      expect(isLookupChannel(id)).toBe(false);
    }
  });
});

describe("the rate limiter", () => {
  it("allows, then blocks, then recovers", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 3,
      cooldownMs: 0,
    });
    const channel = "c";

    expect(limiter.check(channel, 0).allowed).toBe(true);
    expect(limiter.check(channel, 1).allowed).toBe(true);
    expect(limiter.check(channel, 2).allowed).toBe(true);

    const blocked = limiter.check(channel, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.reason).toBe("window");

    // Still blocked inside the window.
    expect(limiter.check(channel, 59_999).allowed).toBe(false);
    // The window has rolled past the first three hits.
    expect(limiter.check(channel, 60_001).allowed).toBe(true);
  });

  it("enforces a cooldown between answers", () => {
    const limiter = createRateLimiter({ max: 10, cooldownMs: 3000 });

    expect(limiter.check("c", 0).allowed).toBe(true);
    const tooSoon = limiter.check("c", 2999);
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.allowed === false && tooSoon.reason).toBe("cooldown");
    expect(limiter.check("c", 3000).allowed).toBe(true);
  });

  it("counts each channel separately", () => {
    const limiter = createRateLimiter({ max: 1, cooldownMs: 0 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 1).allowed).toBe(false);
  });
});

/** A recording `send`, typed so `mock.calls` is readable without a cast. */
const createSend = () =>
  vi.fn((_channelId: string, _body: LookupReply) => Promise.resolve());

type Send = ReturnType<typeof createSend>;

/** The one call the tests below assert on. Throws rather than returning
 *  optionals, so an assertion never reads as passing on an absent call. */
const firstCall = (send: Send): [string, LookupReply] => {
  const call = send.mock.calls[0];
  if (!call) {
    throw new Error("send was never called");
  }
  return call;
};

const message = (overrides: Partial<LookupMessage> = {}): LookupMessage => ({
  id: "m1",
  channel_id: GENERAL_CHANNEL_ID,
  guild_id: GUILD_ID,
  content: "b#123",
  author: { id: "user-1" },
  ...overrides,
});

const deps = (fake = createLookupClients()) => {
  const send = createSend();
  return {
    send,
    fake,
    deps: {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    },
  };
};

describe("handling one message", () => {
  it("answers a bot lookup in #general", async () => {
    const { deps: d, send, fake } = deps();

    expect(await handleLookupMessage(message(), d)).toBe("answered");
    expect(send).toHaveBeenCalledTimes(1);

    const [channelId, body] = firstCall(send);
    expect(channelId).toBe(GENERAL_CHANNEL_ID);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0]?.title).toBe("GlyphBot #123");
    expect(body.message_reference).toEqual({
      message_id: "m1",
      fail_if_not_exists: false,
    });
    // One GlyphBots read plus one OpenSea read, and nothing else.
    expect(fake.subrequests).toBe(2);
  });

  it("answers in #show-and-tell too", async () => {
    const { deps: d } = deps();
    const outcome = await handleLookupMessage(
      message({ channel_id: SHOW_AND_TELL_CHANNEL_ID }),
      d
    );
    expect(outcome).toBe("answered");
  });

  it("ignores a message from a bot", async () => {
    const { deps: d, send, fake } = deps();
    const outcome = await handleLookupMessage(
      message({ author: { id: "other-bot", bot: true } }),
      d
    );
    expect(outcome).toBe("bot-author");
    expect(send).not.toHaveBeenCalled();
    expect(fake.subrequests).toBe(0);
  });

  it("ignores its own message even without the bot flag", async () => {
    const { deps: d, send } = deps();
    const outcome = await handleLookupMessage(
      message({ author: { id: "self-bot" } }),
      d
    );
    expect(outcome).toBe("bot-author");
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a DM", async () => {
    const { deps: d, send } = deps();
    const outcome = await handleLookupMessage(
      { ...message(), guild_id: undefined },
      d
    );
    expect(outcome).toBe("no-guild");
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores another guild", async () => {
    const { deps: d } = deps();
    expect(await handleLookupMessage(message({ guild_id: "1" }), d)).toBe(
      "wrong-guild"
    );
  });

  it("ignores a channel outside the allowlist", async () => {
    const { deps: d, send, fake } = deps();
    const outcome = await handleLookupMessage(
      message({ channel_id: "1445943861263208561" }),
      d
    );
    expect(outcome).toBe("channel-not-allowed");
    expect(send).not.toHaveBeenCalled();
    expect(fake.subrequests).toBe(0);
  });

  it("stays quiet when nothing matches", async () => {
    const { deps: d, send, fake } = deps();
    const outcome = await handleLookupMessage(
      message({ content: "no lookups here" }),
      d
    );
    expect(outcome).toBe("no-match");
    expect(send).not.toHaveBeenCalled();
    expect(fake.subrequests).toBe(0);
  });

  it("never sends more than six embeds", async () => {
    const { deps: d, send } = deps();
    const outcome = await handleLookupMessage(
      message({ content: "b#1 b#2 b#3 b#4 b#5 b#6 b#7 b#8 b#9" }),
      d
    );
    expect(outcome).toBe("answered");
    const [, body] = firstCall(send);
    expect(body.embeds).toHaveLength(6);
  });

  it("drops a message once the channel is over its limit", async () => {
    const fake = createLookupClients();
    const send = createSend();
    const d = {
      clients: fake.clients,
      limiter: createRateLimiter({ max: 1, cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    };

    expect(await handleLookupMessage(message(), d)).toBe("answered");
    expect(await handleLookupMessage(message({ id: "m2" }), d)).toBe(
      "rate-limited"
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not spend the channel budget on ordinary chat", async () => {
    const fake = createLookupClients();
    const send = createSend();
    const d = {
      clients: fake.clients,
      limiter: createRateLimiter({ max: 1, cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    };

    await handleLookupMessage(message({ content: "hey" }), d);
    await handleLookupMessage(message({ content: "how is everyone" }), d);
    expect(await handleLookupMessage(message({ id: "m3" }), d)).toBe(
      "answered"
    );
  });

  it("answers with the embeds that did resolve when one lookup misses", async () => {
    const fake = createLookupClients({ bots: { 1: null, 2: createBot(2) } });
    const send = createSend();
    const outcome = await handleLookupMessage(message({ content: "b#1 b#2" }), {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    });

    expect(outcome).toBe("answered");
    const [, body] = firstCall(send);
    expect(body.embeds).toHaveLength(1);
  });

  it("says nothing at all when every lookup misses", async () => {
    const fake = createLookupClients({ bots: { 1: null } });
    const send = createSend();
    const outcome = await handleLookupMessage(message({ content: "b#1" }), {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    });

    expect(outcome).toBe("no-embeds");
    expect(send).not.toHaveBeenCalled();
  });

  it("resolves a username to a bot the account holds", async () => {
    const fake = createLookupClients({
      accountNFTs: [
        {
          identifier: "77",
          collection: "glyphbots",
          contract: "0xb6c2",
          name: "GlyphBot #77",
        },
      ],
    });
    const send = createSend();

    const outcome = await handleLookupMessage(message({ content: "#ryan" }), {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    });

    expect(outcome).toBe("answered");
    const [, body] = firstCall(send);
    expect(body.embeds[0]?.title).toBe("GlyphBot #77");
    // account, account NFTs, then the bot lookup's two.
    expect(fake.subrequests).toBe(4);
  });

  it("says nothing for a username that holds no GlyphBots", async () => {
    const fake = createLookupClients({ accountNFTs: [] });
    const send = createSend();
    const outcome = await handleLookupMessage(message({ content: "#nobody" }), {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    });
    expect(outcome).toBe("no-embeds");
  });

  it("puts the artifact image on an artifact lookup", async () => {
    const fake = createLookupClients({
      artifacts: { 3: createArtifact({ contractTokenId: 3 }) },
    });
    const send = createSend();

    await handleLookupMessage(message({ content: "a#3" }), {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    });

    const [, body] = firstCall(send);
    expect(body.embeds[0]?.image?.url).toBe(
      "https://www.glyphbots.com/artifacts/3.jpg"
    );
  });

  it("titles an untitled artifact rather than dropping the heading", async () => {
    // `setTitle(null)` is accepted and drops the title, and the link rides on
    // the title, so an untitled artifact answered with an unclickable embed.
    const fake = createLookupClients({
      artifacts: { 4: createArtifact({ contractTokenId: 4, title: null }) },
    });
    const send = createSend();

    await handleLookupMessage(message({ content: "a#4" }), {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    });

    const [, body] = firstCall(send);
    expect(body.embeds[0]?.title).toBe("Artifact");
    expect(body.embeds[0]?.url).toBe("https://www.glyphbots.com/artifact/4");
  });

  it("renders traits on one line, the same shape /bot uses", async () => {
    const fake = createLookupClients({
      bots: {
        123: createBot(123, {
          traits: [
            { trait_type: "Name", value: "Vector" },
            { trait_type: "Head", value: "▲▼▲▼▲" },
            { trait_type: "Eyes", value: "◇◇" },
            { trait_type: "Body", value: "None" },
          ],
        }),
      },
    });
    const send = createSend();

    await handleLookupMessage(message(), {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    });

    const [, body] = firstCall(send);
    const traits = body.embeds[0]?.fields?.find(
      (f: { name: string }) => f.name === "Traits"
    );

    expect(traits?.value).toBe("**Head** ▲▼▲▼▲ · **Eyes** ◇◇");
    expect(traits?.inline).toBeFalsy();
  });

  it("omits the traits field when a bot has nothing worth showing", async () => {
    const fake = createLookupClients({
      bots: {
        123: createBot(123, {
          traits: [
            { trait_type: "Name", value: "Vector" },
            { trait_type: "Body", value: "None" },
          ],
        }),
      },
    });
    const send = createSend();

    await handleLookupMessage(message(), {
      clients: fake.clients,
      limiter: createRateLimiter({ cooldownMs: 0 }),
      send,
      selfUserId: "self-bot",
    });

    const [, body] = firstCall(send);
    const fields: Array<{ name: string; value: string }> =
      body.embeds[0]?.fields ?? [];

    expect(fields.map((f) => f.name)).not.toContain("Traits");
    for (const field of fields) {
      expect(field.value.length).toBeGreaterThan(0);
    }
  });

  it("uses the first-party PNG for a bot, never an OpenSea image", async () => {
    const { deps: d, send } = deps();
    await handleLookupMessage(message(), d);
    const [, body] = firstCall(send);
    expect(body.embeds[0]?.image?.url).toBe(
      "https://www.glyphbots.com/bots/pngs/123.png"
    );
  });
});
