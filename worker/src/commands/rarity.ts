/**
 * `/rarity`.
 *
 * Traits and rank come from OpenSea, the thumbnail from the first-party PNG
 * endpoint. That split was already correct on the Node bot and is preserved.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { getOpenSeaUrl } from "../api/opensea";
import { COLORS, MAX_BOT_TOKEN_ID } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply } from "../discord/embeds";
import type { CommandHandler } from "./context";

const PERCENT = 100;
const TRAIT_LIMIT = 8;

/** Where a rank sits in the supply, as a percentage. 1 is the rarest. */
export const percentileOf = (rank: number): number =>
  (rank / MAX_BOT_TOKEN_ID) * PERCENT;

/**
 * The tier table, rarest first. The first row a rank's percentile clears wins,
 * and anything past the last row is Standard.
 *
 * One table rather than three parallel `if` ladders, because five callers now
 * read tiers out of this file (`/rarity`, `/sales`, `/activity`, the sales
 * feed's embeds and the idle nudge's "notable bot" post) and a threshold that
 * moved in the emoji ladder but not the name ladder would be invisible until
 * somebody noticed a 🏆 labelled Epic.
 */
const TIERS = [
  { maxPercentile: 1, name: "Legendary", emoji: "🏆" },
  { maxPercentile: 5, name: "Epic", emoji: "💎" },
  { maxPercentile: 10, name: "Rare", emoji: "🥇" },
  { maxPercentile: 25, name: "Uncommon", emoji: "🥈" },
  { maxPercentile: 50, name: "Common", emoji: "🥉" },
] as const;

const STANDARD = { name: "Standard", emoji: "⭐" } as const;

type Tier = (typeof TIERS)[number] | typeof STANDARD;

const tierOf = (rank: number): Tier => {
  const percentile = percentileOf(rank);
  return TIERS.find((tier) => percentile <= tier.maxPercentile) ?? STANDARD;
};

/**
 * Exported alongside the tier helpers, because the idle nudge's "notable bot"
 * post labels its pick with the same table rather than a second one that could
 * drift from this.
 */
export const getRarityEmoji = (rank: number): string => tierOf(rank).emoji;

/** Just the word: `Epic`. What the compact one-line forms below carry. */
export const getRarityTierName = (rank: number): string => tierOf(rank).name;

/** The full label: `Epic (Top 5%)`, or a bare `Standard` past the halfway mark. */
export const getRarityTier = (rank: number): string => {
  const tier = tierOf(rank);
  return "maxPercentile" in tier
    ? `${tier.name} (Top ${tier.maxPercentile}%)`
    : tier.name;
};

/**
 * `💎 Rank #421 (Epic)`. The form that rides a list: one sale line, one item in
 * a sweep, one embed field.
 *
 * "Rank" is spelled out because these all sit next to a token id, and a bare
 * `#421` two words away from `GlyphBot #4210` reads as a second token.
 */
export const rarityBadge = (rank: number): string =>
  `${getRarityEmoji(rank)} Rank #${rank.toLocaleString()} (${getRarityTierName(rank)})`;

/**
 * `💎 Rank #421 / 11,111 · Epic (Top 5%)`. The form for a reply about one bot,
 * where there is room for the denominator and the percentile.
 */
export const rarityLine = (rank: number): string =>
  `${getRarityEmoji(rank)} Rank #${rank.toLocaleString()} / ${MAX_BOT_TOKEN_ID.toLocaleString()} · ${getRarityTier(rank)}`;

export const handleRarity: CommandHandler = async (ctx) => {
  const tokenId = ctx.options.getInteger("bot");

  if (tokenId === null) {
    return errorReply("❌ Missing Bot ID", "Please provide a bot token id.");
  }

  const nft = await ctx.opensea.fetchNFT(tokenId);

  if (!nft) {
    return errorReply(
      "❌ Bot Not Found",
      `GlyphBot #${tokenId} was not found.`
    );
  }

  // Truthy, not nullish: OpenSea sends `name: ""` for a token it has not
  // finished indexing, and `setTitle("")` throws.
  const botName = nft.name || `GlyphBot #${tokenId}`;

  // No rank means no rank, not rank zero. `percentileOf(0)` is 0, which clears
  // every threshold in the table, so the old `?? 0` printed "#0 / 11,111" and
  // "Legendary (Top 1%)" for any bot OpenSea had not ranked. The two other
  // readers of this field already refuse it: `nudge-content.ts` skips a
  // candidate whose rank is `<= 0`, and `lookups/embeds.ts` leaves the field
  // off when it is null. This does the same.
  const rawRank = nft.rarity?.rank ?? null;
  const rank = rawRank !== null && rawRank > 0 ? rawRank : null;

  const traitLines = (nft.traits ?? [])
    .filter(
      (t) => t.trait_type !== "Name" && t.value !== "None" && t.value !== "No"
    )
    .slice(0, TRAIT_LIMIT)
    .map((t) => `**${t.trait_type}:** ${t.value}`);

  const description = [
    ...(rank === null
      ? []
      : [
          `**Rarity Rank:** #${rank.toLocaleString()} / ${MAX_BOT_TOKEN_ID.toLocaleString()}`,
          `**Tier:** ${getRarityTier(rank)}`,
          "",
        ]),
    traitLines.length > 0 ? "**Traits:**" : "",
    ...traitLines,
  ]
    .filter(Boolean)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLORS.rarity)
    .setTitle(rank === null ? botName : `${getRarityEmoji(rank)} ${botName}`)
    .setThumbnail(ctx.glyphbots.getBotPngUrl(tokenId));

  // `setDescription("")` throws, and an unranked bot with no printable traits
  // leaves nothing to say.
  if (description) {
    embed.setDescription(description);
  }

  embed.setFooter({
    text:
      rank === null
        ? "OpenSea has no rarity rank for this bot"
        : "Rarity calculated by OpenRarity",
  });

  return embedReply(embed, [
    linkButtonRow([
      { label: "View Bot", url: ctx.glyphbots.getBotUrl(tokenId), emoji: "🤖" },
      { label: "View on OpenSea", url: getOpenSeaUrl(tokenId), emoji: "🌊" },
    ]),
  ]);
};
