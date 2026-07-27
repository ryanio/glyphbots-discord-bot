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
      "**Head** Antenna"
    );
  });

  it("puts every trait on one line and drops the Name trait", async () => {
    const glyphbots = stubGlyphBots({
      fetchBot: vi.fn(() =>
        Promise.resolve(
          createBot({
            traits: [
              { trait_type: "Name", value: "Wanderer" },
              { trait_type: "Head", value: "▲▼▲▼▲" },
              { trait_type: "Eyes", value: "◇◇" },
              { trait_type: "Arms", value: "None" },
            ],
          })
        )
      ),
      fetchBotStory: vi.fn(() => Promise.resolve(createStory())),
    });
    const ctx = commandContext({
      glyphbots,
      opensea: stubOpenSea({ fetchNFT: vi.fn(() => Promise.resolve(createNFT())) }),
      options: readOptions([intOption("id", 7)]),
    });

    const traits =
      firstEmbed(await handleBot(ctx)).fields?.find((f) => f.name === "Traits")
        ?.value ?? "";

    expect(traits).toBe("**Head** ▲▼▲▼▲ · **Eyes** ◇◇");
    expect(traits).not.toContain("\n");
    expect(traits).not.toContain("Wanderer");
  });

  it("keeps an unusually long trait list inside Discord's field limit", async () => {
    const traits = Array.from({ length: 60 }, (_, i) => ({
      trait_type: `Module ${i}`,
      value: "◇".repeat(40),
    }));
    const glyphbots = stubGlyphBots({
      fetchBot: vi.fn(() => Promise.resolve(createBot({ traits }))),
      fetchBotStory: vi.fn(() => Promise.resolve(createStory())),
    });
    const ctx = commandContext({
      glyphbots,
      opensea: stubOpenSea({ fetchNFT: vi.fn(() => Promise.resolve(createNFT())) }),
      options: readOptions([intOption("id", 7)]),
    });

    const value =
      firstEmbed(await handleBot(ctx)).fields?.find((f) => f.name === "Traits")
        ?.value ?? "";

    expect(value.length).toBeLessThanOrEqual(1024);
    expect(value.endsWith("…")).toBe(true);
  });

  it("renders the stats as a 3x2 grid and caps powers at three", async () => {
    const { ctx } = setup();
    const embed = firstEmbed(await handleBot(ctx));

    const stats = embed.fields?.find((f) => f.name === "Stats")?.value ?? "";
    // Two rows of three, no bars. Absent stats fall back to zero.
    expect(stats).toBe("```\nSTR  40  AGI  70  INT   0\nLCK   0  END   0  CHA   0\n```");

    expect(embed.fields?.find((f) => f.name === "Role")?.value).toBe(
      "Driftwatch\nScout"
    );
    expect(embed.fields?.find((f) => f.name === "Powers")?.value).toBe(
      "Echo Sense · Static Veil · Null Step"
    );
  });

  it("omits Role, Stats and Powers entirely when a bot has no story", async () => {
    const glyphbots = stubGlyphBots({
      fetchBot: vi.fn(() => Promise.resolve(createBot())),
      fetchBotStory: vi.fn(() => Promise.resolve(null)),
    });
    const ctx = commandContext({
      glyphbots,
      opensea: stubOpenSea({ fetchNFT: vi.fn(() => Promise.resolve(createNFT())) }),
      options: readOptions([intOption("id", 7)]),
    });

    const fields = firstEmbed(await handleBot(ctx)).fields ?? [];
    const names = fields.map((f) => f.name);

    expect(names).not.toContain("Role");
    expect(names).not.toContain("Stats");
    expect(names).not.toContain("Powers");
    // Discord rejects an empty field value, so there must be none.
    for (const field of fields) {
      expect(field.value.length).toBeGreaterThan(0);
    }
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
    // The mint date rides in the footer instead of a fourth inline field.
    // The day depends on the runner's zone, so match the shape, not the date.
    expect(embed.footer?.text).toMatch(
      /^GlyphBots Artifacts · Minted Jan \d+, 2025$/
    );
    expect(embed.fields?.map((f) => f.name)).not.toContain("Minted");
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

  it("does not quote a non-ETH floor as ETH", async () => {
    // `formatEthStat` writes the unit into the string, so printing a floor
    // denominated in anything else states something untrue. Same rule the idle
    // nudge's `collectionFacts` already applied, now shared.
    const stats = createStats();
    stats.total.floor_price_symbol = "SOL";
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionStats: vi.fn(() => Promise.resolve(stats)),
      }),
    });

    const embed = firstEmbed(await handleFloor(ctx));
    expect(embed.fields?.[0]).toMatchObject({
      name: "💎 Floor Price",
      value: "—",
    });
    // And the rest of the answer is unaffected.
    expect(embed.fields?.find((f) => f.name === "👥 Owners")?.value).toBe(
      "2.1K"
    );
  });

  it("still quotes the floor when the symbol is absent", async () => {
    const stats = createStats();
    stats.total.floor_price_symbol = undefined as unknown as string;
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionStats: vi.fn(() => Promise.resolve(stats)),
      }),
    });

    expect(firstEmbed(await handleFloor(ctx)).fields?.[0]?.value).toBe(
      "0.0450 ETH"
    );
  });

  it("degrades to a partial answer when the response has holes", async () => {
    // The declared types say every one of these is a required number. A
    // partial index at OpenSea says otherwise, and each of them used to reach
    // `toFixed` or `toLocaleString` on `undefined` and throw the handler.
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionStats: vi.fn(() =>
          Promise.resolve({
            total: { volume: 10 },
            intervals: [{ interval: "one_day", sales: 4 }],
          } as never)
        ),
      }),
    });

    const embed = firstEmbed(await handleFloor(ctx));
    const value = (name: string) =>
      embed.fields?.find((f) => f.name === name)?.value;

    expect(embed.fields).toHaveLength(9);
    expect(value("📈 Total Volume")).toBe("10.00 ETH");
    expect(value("📊 24h Sales")).toBe("4");
    expect(value("💎 Floor Price")).toBe("—");
    expect(value("👥 Owners")).toBe("—");
    expect(value("🏷️ Avg Price")).toBe("—");
    expect(value("📊 Total Sales")).toBe("—");
    expect(value("📈 30d Sales")).toBe("—");
  });

  it("survives a response with no total or intervals at all", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionStats: vi.fn(() => Promise.resolve({} as never)),
      }),
    });

    const embed = firstEmbed(await handleFloor(ctx));
    expect(embed.fields).toHaveLength(9);
    for (const field of embed.fields ?? []) {
      expect(field.value).toBe("—");
    }
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

  it("/sales omits the link when the event carries no token id", async () => {
    // The id used to fall back to the string "?", and `Number("?")` is NaN, so
    // the line linked to `/bot/NaN`.
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionEvents: vi.fn(() =>
          Promise.resolve([createSaleEvent({ nft: undefined })])
        ),
      }),
    });

    const embed = firstEmbed(await handleSales(ctx));
    expect(embed.description).not.toContain("NaN");
    expect(embed.description).not.toContain("](");
    expect(embed.description).toContain("**1.** GlyphBot → 0.5000 ETH");
  });

  it("/sales omits the link when the token id is not a number", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchCollectionEvents: vi.fn(() =>
          Promise.resolve([
            createSaleEvent({ nft: { identifier: "not-a-number" } }),
          ])
        ),
      }),
    });

    const embed = firstEmbed(await handleSales(ctx));
    expect(embed.description).not.toContain("NaN");
    expect(embed.description).not.toContain("](");
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

  it("/rarity says nothing about rank when OpenSea has none", async () => {
    // `?? 0` made an unranked bot rank zero, `percentileOf(0)` is 0, and 0
    // clears every threshold in the table, so the user was told an unranked
    // bot was "Legendary (Top 1%)". Both other readers of this field already
    // refuse a missing or non-positive rank.
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchNFT: vi.fn(() =>
          Promise.resolve(
            createNFT({
              rarity: undefined,
              traits: [
                {
                  trait_type: "Head",
                  value: "Antenna",
                  display_type: null,
                  max_value: null,
                },
              ],
            })
          )
        ),
      }),
      options: readOptions([intOption("bot", 7)]),
    });

    const embed = firstEmbed(await handleRarity(ctx));

    expect(embed.description).not.toContain("Legendary");
    expect(embed.description).not.toContain("Rarity Rank");
    expect(embed.description).not.toContain("Tier");
    expect(embed.description).not.toContain("#0");
    expect(embed.title).toBe("GlyphBot #7");
    // The traits it does have still show.
    expect(embed.description).toContain("**Head:** Antenna");
    expect(embed.thumbnail?.url).toBe(`${TEST_ORIGIN}/bots/pngs/7.png`);
  });

  it("/rarity treats a zero rank as no rank", async () => {
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchNFT: vi.fn(() =>
          Promise.resolve(
            createNFT({
              rarity: { strategy_id: "openrarity", strategy_version: "1", rank: 0 },
              traits: [
                {
                  trait_type: "Head",
                  value: "Antenna",
                  display_type: null,
                  max_value: null,
                },
              ],
            })
          )
        ),
      }),
      options: readOptions([intOption("bot", 7)]),
    });

    const embed = firstEmbed(await handleRarity(ctx));
    expect(embed.description).toBe("**Traits:**\n**Head:** Antenna");
    expect(embed.title).toBe("GlyphBot #7");
  });

  it("/rarity answers at all for an unranked bot with no traits", async () => {
    // An empty description is rejected by the builder, so this is the case
    // where omitting the rank lines could have thrown instead.
    const ctx = commandContext({
      opensea: stubOpenSea({
        fetchNFT: vi.fn(() =>
          Promise.resolve(createNFT({ rarity: undefined, traits: [] }))
        ),
      }),
      options: readOptions([intOption("bot", 7)]),
    });

    const embed = firstEmbed(await handleRarity(ctx));
    expect(embed.title).toBe("GlyphBot #7");
    expect(embed.description).toBeUndefined();
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
