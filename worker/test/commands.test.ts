/**
 * Per-command response shaping, against stubbed API clients.
 *
 * The recurring assertion across these is the image rule: nothing sourced from
 * OpenSea may become an embed image, because OpenSea serves `image/svg+xml`
 * for this contract and Discord renders nothing for SVG. Every image and
 * thumbnail here has to be a `/bots/pngs/<id>.png` URL from the first-party
 * helper.
 */

import type { APIEmbed } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { handleActivity } from "../src/commands/activity";
import { handleArtifact } from "../src/commands/artifact";
import { handleBot } from "../src/commands/bot";
import { readOptions } from "../src/commands/context";
import { handleFloor } from "../src/commands/floor";
import { handleListings } from "../src/commands/listings";
import { handleOwner } from "../src/commands/owner";
import { handleRarity } from "../src/commands/rarity";
import { handleSales } from "../src/commands/sales";
import type { FollowUp } from "../src/discord/interactions";
import {
  boolOption,
  commandContext,
  createArtifactFixture,
  createBot,
  createListing,
  createNFT,
  createSaleEvent,
  createStats,
  createStory,
  intOption,
  stringOption,
  stubGlyphBots,
  stubOpenSea,
  TEST_ORIGIN,
} from "./interaction-fixtures";

const firstEmbed = (reply: FollowUp): APIEmbed => {
  const embed = reply.embeds?.[0];
  if (!embed) {
    throw new Error("expected an embed");
  }
  return embed as APIEmbed;
};

/** URLs on the reply, so the SVG rule can be asserted in one place. */
const imageUrls = (reply: FollowUp): string[] => {
  const embed = firstEmbed(reply);
  return [embed.image?.url, embed.thumbnail?.url].filter(
    (url): url is string => typeof url === "string"
  );
};

describe("/bot", () => {
  const setup = (options = [intOption("id", 7)]) => {
    const glyphbots = stubGlyphBots({
      fetchBot: vi.fn(() => Promise.resolve(createBot())),
      fetchBotStory: vi.fn(() => Promise.resolve(createStory())),
    });
    const opensea = stubOpenSea({
      fetchNFT: vi.fn(() => Promise.resolve(createNFT())),
    });
    return {
      glyphbots,
      opensea,
      ctx: commandContext({
        glyphbots,
        opensea,
        options: readOptions(options),
      }),
    };
  };

  it("builds the bot embed from the id option", async () => {
    const { ctx } = setup();
    const reply = await handleBot(ctx);
    const embed = firstEmbed(reply);

    expect(embed.title).toBe("GlyphBot #7");
    expect(embed.url).toBe(`${TEST_ORIGIN}/bot/7`);
    expect(embed.description).toBe("**Wanderer**");
    expect(embed.footer?.text).toBe("GlyphBots");
  });

  it("uses the first-party PNG, never an OpenSea image", async () => {
    const { ctx } = setup();
    const reply = await handleBot(ctx);

    expect(firstEmbed(reply).image?.url).toBe(`${TEST_ORIGIN}/bots/pngs/7.png`);
    for (const url of imageUrls(reply)) {
      expect(url).toContain("/bots/pngs/");
      expect(url).not.toContain("opensea");
      expect(url).not.toMatch(/\.svg/);
    }
  });

  it("carries owner and rarity from OpenSea into fields, and skips 'None' traits", async () => {
    const { ctx } = setup();
    const embed = firstEmbed(await handleBot(ctx));
    const names = embed.fields?.map((f) => f.name) ?? [];

    expect(names).toContain("Owner");
    expect(names).toContain("Rarity");
    expect(embed.fields?.find((f) => f.name === "Rarity")?.value).toBe(
      "#42 / 11,111"
    );
    expect(embed.fields?.find((f) => f.name === "Traits")?.value).toBe(
      "**Head:** Antenna"
    );
  });

  it("renders the story stat bars and caps powers at three", async () => {
    const { ctx } = setup();
    const embed = firstEmbed(await handleBot(ctx));

    const stats = embed.fields?.find((f) => f.name === "Stats")?.value ?? "";
    expect(stats).toContain("STR ████░░░░░░ 40");
    expect(stats).toContain("AGI ███████░░░ 70");
    // Absent stats fall back to zero rather than dropping the row.
    expect(stats).toContain("LCK ░░░░░░░░░░ 0");

    expect(embed.fields?.find((f) => f.name === "Powers")?.value).toBe(
      "Echo Sense • Static Veil • Null Step"
    );
  });

  it("attaches two link buttons", async () => {
    const { ctx } = setup();
    const reply = await handleBot(ctx);
    const row = reply.components?.[0] as { components: unknown[] };

    expect(row.components).toHaveLength(2);
  });

  it("random:true picks a token without consulting any wallet store", async () => {
    const { ctx, opensea } = setup([boolOption("random", true)]);

    const embed = firstEmbed(await handleBot(ctx));

    expect(embed.title).toMatch(/^GlyphBot #\d+$/);
    // The wallet-backed variant is gone, so nothing looks up an account.
    expect(opensea.fetchAccountNFTs).not.toHaveBeenCalled();
  });

  it("user: picks from that account's bots", async () => {
    const opensea = stubOpenSea({
      fetchAccountNFTs: vi.fn(() =>
        Promise.resolve([
          { identifier: "77", collection: "glyphbots", contract: "0x0" },
        ])
      ),
      fetchNFT: vi.fn(() => Promise.resolve(createNFT())),
    });
    const ctx = commandContext({
      glyphbots: stubGlyphBots({
        fetchBot: vi.fn(() => Promise.resolve(createBot({ tokenId: 77 }))),
      }),
      opensea,
      options: readOptions([stringOption("user", "someone")]),
    });

    expect(firstEmbed(await handleBot(ctx)).title).toBe("GlyphBot #77");
    expect(opensea.fetchAccountNFTs).toHaveBeenCalledWith("someone");
  });

  it("explains an account with no GlyphBots", async () => {
    const ctx = commandContext({
      options: readOptions([stringOption("user", "nobody")]),
    });

    expect(firstEmbed(await handleBot(ctx)).title).toBe("No GlyphBots Found");
  });

  it("asks for input when nothing was provided", async () => {
    const embed = firstEmbed(await handleBot(commandContext()));
    expect(embed.title).toBe("Missing Bot ID");
  });

  it("reports a bot the API does not know", async () => {
    const ctx = commandContext({ options: readOptions([intOption("id", 7)]) });
    expect(firstEmbed(await handleBot(ctx)).title).toBe("Bot Not Found");
  });
});

describe("/artifact", () => {
  const glyphbots = () =>
    stubGlyphBots({
      fetchArtifact: vi.fn(() => Promise.resolve(createArtifactFixture())),
      fetchBot: vi.fn(() => Promise.resolve(createBot())),
      fetchRecentArtifacts: vi.fn(() =>
        Promise.resolve([createArtifactFixture({ id: "only" })])
      ),
    });

  it("builds the artifact embed from the id option", async () => {
    const ctx = commandContext({
      glyphbots: glyphbots(),
      options: readOptions([intOption("id", 12)]),
    });

    const embed = firstEmbed(await handleArtifact(ctx));

    expect(embed.title).toBe("Signal Bloom");
    expect(embed.url).toBe(`${TEST_ORIGIN}/artifact/12`);
    expect(embed.footer?.text).toBe("GlyphBots Artifacts");
    expect(embed.fields?.find((f) => f.name === "Token ID")?.value).toBe("#12");
    expect(embed.fields?.find((f) => f.name === "Type")?.value).toBe("Image");
    expect(embed.fields?.find((f) => f.name === "Origin Bot")?.value).toBe(
      `[Wanderer](${TEST_ORIGIN}/bot/7)`
    );
  });

  it("uses the first-party artifact image and never touches OpenSea", async () => {
    const opensea = stubOpenSea();
    const ctx = commandContext({
      glyphbots: glyphbots(),
      opensea,
      options: readOptions([intOption("id", 12)]),
    });

    const reply = await handleArtifact(ctx);

    expect(firstEmbed(reply).image?.url).toBe(
      "https://www.glyphbots.com/artifacts/1.jpg"
    );
    for (const call of Object.values(opensea)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("random:true picks from the recent list", async () => {
    const ctx = commandContext({
      glyphbots: glyphbots(),
      options: readOptions([boolOption("random", true)]),
    });

    expect(firstEmbed(await handleArtifact(ctx)).title).toBe("Signal Bloom");
  });

  it("reports an empty recent list", async () => {
    const ctx = commandContext({
      options: readOptions([boolOption("random", true)]),
    });

    expect(firstEmbed(await handleArtifact(ctx)).title).toBe(
      "No Artifacts Found"
    );
  });

  it("asks for input when nothing was provided", async () => {
    expect(firstEmbed(await handleArtifact(commandContext())).title).toBe(
      "Missing Artifact ID"
    );
  });

  it("gives three buttons when the artifact is minted", async () => {
    const ctx = commandContext({
      glyphbots: glyphbots(),
      options: readOptions([intOption("id", 12)]),
    });

    const row = (await handleArtifact(ctx)).components?.[0] as {
      components: unknown[];
    };

    expect(row.components).toHaveLength(3);
  });
});

describe("/floor", () => {
  it("shapes the nine stat fields", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionStats: vi.fn(() => Promise.resolve(createStats())),
      }),
    });

    const embed = firstEmbed(await handleFloor(ctx));

    expect(embed.title).toBe("📊 GlyphBots Collection Stats");
    expect(embed.fields).toHaveLength(9);
    expect(embed.fields?.[0]).toMatchObject({
      name: "💎 Floor Price",
      value: "0.0450 ETH",
    });
    expect(embed.fields?.find((f) => f.name === "👥 Owners")?.value).toBe(
      "2.1K"
    );
    expect(embed.fields?.find((f) => f.name === "📈 7d Change")?.value).toBe(
      "-25.0%"
    );
    expect(embed.fields?.find((f) => f.name === "📈 Total Volume")?.value).toBe(
      "1234.50 ETH"
    );
  });

  it("carries no image at all, so there is no SVG to get wrong", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionStats: vi.fn(() => Promise.resolve(createStats())),
      }),
    });

    expect(imageUrls(await handleFloor(ctx))).toEqual([]);
  });

  it("reports an unavailable stats endpoint", async () => {
    expect(firstEmbed(await handleFloor(commandContext())).title).toBe(
      "❌ Error"
    );
  });

  it("shows a dash for a missing interval", async () => {
    const stats = createStats();
    stats.intervals = [];
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionStats: vi.fn(() => Promise.resolve(stats)),
      }),
    });

    const embed = firstEmbed(await handleFloor(ctx));
    expect(embed.fields?.find((f) => f.name === "🔄 24h Volume")?.value).toBe(
      "—"
    );
  });
});

describe("the remaining four", () => {
  it("/sales lists sales and links to glyphbots.com", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionEvents: vi.fn(() => Promise.resolve([createSaleEvent()])),
      }),
    });

    const embed = firstEmbed(await handleSales(ctx));
    expect(embed.title).toBe("💰 Recent GlyphBots Sales");
    expect(embed.description).toContain(`[GlyphBot #7](${TEST_ORIGIN}/bot/7)`);
    expect(embed.description).toContain("0.5000 ETH");
  });

  it("/sales reports an empty feed", async () => {
    expect(firstEmbed(await handleSales(commandContext())).title).toBe(
      "📉 No Recent Sales"
    );
  });

  it("/listings lists price and seller", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchListings: vi.fn(() => Promise.resolve([createListing()])),
      }),
    });

    const embed = firstEmbed(await handleListings(ctx));
    expect(embed.title).toBe("🏷️ Cheapest GlyphBots For Sale");
    expect(embed.description).toContain("0.0450 ETH");
  });

  it("/listings reports an empty book", async () => {
    expect(firstEmbed(await handleListings(commandContext())).title).toBe(
      "📋 No Active Listings"
    );
  });

  it("/owner resolves the account and thumbnails the PNG", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchNFT: vi.fn(() => Promise.resolve(createNFT())),
        fetchAccount: vi.fn(() =>
          Promise.resolve({ address: "0x12", username: "collector" })
        ),
      }),
      options: readOptions([intOption("bot", 7)]),
    });

    const reply = await handleOwner(ctx);
    const embed = firstEmbed(reply);

    expect(embed.title).toBe("🤖 GlyphBot #7");
    expect(embed.description).toContain("**Owner:** @collector");
    expect(embed.thumbnail?.url).toBe(`${TEST_ORIGIN}/bots/pngs/7.png`);
    expect(imageUrls(reply).every((u) => u.includes("/bots/pngs/"))).toBe(true);
  });

  it("/owner reports an unknown bot", async () => {
    const ctx = commandContext({ options: readOptions([intOption("bot", 7)]) });
    expect(firstEmbed(await handleOwner(ctx)).title).toBe("❌ Bot Not Found");
  });

  it("/rarity tiers the rank and thumbnails the PNG", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchNFT: vi.fn(() =>
          Promise.resolve(
            createNFT({
              traits: [
                { trait_type: "Head", value: "Antenna", display_type: null, max_value: null },
                { trait_type: "Aura", value: "None", display_type: null, max_value: null },
              ],
            })
          )
        ),
      }),
      options: readOptions([intOption("bot", 7)]),
    });

    const embed = firstEmbed(await handleRarity(ctx));

    expect(embed.title).toBe("🏆 GlyphBot #7");
    expect(embed.description).toContain("**Rarity Rank:** #42 / 11,111");
    expect(embed.description).toContain("Legendary (Top 1%)");
    expect(embed.description).toContain("**Head:** Antenna");
    expect(embed.description).not.toContain("Aura");
    expect(embed.thumbnail?.url).toBe(`${TEST_ORIGIN}/bots/pngs/7.png`);
  });

  it("/activity formats each event kind and thumbnails the PNG", async () => {
    const now = Math.floor(Date.now() / 1000);
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchNFTEvents: vi.fn(() =>
          Promise.resolve([
            createSaleEvent({ event_timestamp: now - 3600 }),
            createSaleEvent({
              event_type: "transfer",
              event_timestamp: now - 90_000,
              to_address: "0xabcdef1234567890abcdef1234567890abcdef12",
            }),
            createSaleEvent({ event_type: "listing", event_timestamp: now - 30 }),
          ])
        ),
      }),
      options: readOptions([intOption("bot", 7)]),
    });

    const reply = await handleActivity(ctx);
    const embed = firstEmbed(reply);

    expect(embed.title).toBe("📊 Activity: GlyphBot #7");
    expect(embed.description).toContain("💰 **Sold** for 0.5000 ETH");
    expect(embed.description).toContain("(1h ago)");
    expect(embed.description).toContain("📦 **Transferred**");
    expect(embed.description).toContain("(1d ago)");
    expect(embed.description).toContain("🏷️ **Listed** for 0.5000 ETH");
    expect(embed.description).toContain("(just now)");
    expect(embed.thumbnail?.url).toBe(`${TEST_ORIGIN}/bots/pngs/7.png`);
  });

  it("/activity reports an empty history", async () => {
    const ctx = commandContext({ options: readOptions([intOption("bot", 7)]) });
    expect(firstEmbed(await handleActivity(ctx)).title).toBe(
      "📋 No Activity Found"
    );
  });
});
