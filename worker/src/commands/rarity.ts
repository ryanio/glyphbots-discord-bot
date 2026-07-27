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
 * Exported alongside `getRarityTier`, because the idle nudge's "notable bot"
 * post labels its pick with the same two functions rather than a second table
 * that could drift from this one.
 */
export const getRarityEmoji = (rank: number): string => {
  const percentile = percentileOf(rank);
  if (percentile <= 1) {
    return "🏆";
  }
  if (percentile <= 5) {
    return "💎";
  }
  if (percentile <= 10) {
    return "🥇";
  }
  if (percentile <= 25) {
    return "🥈";
  }
  if (percentile <= 50) {
    return "🥉";
  }
  return "⭐";
};

export const getRarityTier = (rank: number): string => {
  const percentile = percentileOf(rank);
  if (percentile <= 1) {
    return "Legendary (Top 1%)";
  }
  if (percentile <= 5) {
    return "Epic (Top 5%)";
  }
  if (percentile <= 10) {
    return "Rare (Top 10%)";
  }
  if (percentile <= 25) {
    return "Uncommon (Top 25%)";
  }
  if (percentile <= 50) {
    return "Common (Top 50%)";
  }
  return "Standard";
};

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
