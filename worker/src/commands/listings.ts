/**
 * `/listings`, ported from `src/commands/listings.ts`.
 *
 * OpenSea's best-listings response carries no token id we can trust to map
 * back to a bot, so the original listed price and seller only. That is kept.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { shortAddress } from "../api/glyphbots";
import { getOpenSeaCollectionUrl } from "../api/opensea";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply } from "../discord/embeds";
import type { CommandHandler } from "./context";
import { formatEthAmount } from "./format";

const FETCH_LIMIT = 10;
const DISPLAY_LIMIT = 8;

export const handleListings: CommandHandler = async (ctx) => {
  const listings = await ctx.opensea.fetchListings(FETCH_LIMIT);

  if (listings.length === 0) {
    return errorReply(
      "📋 No Active Listings",
      "No GlyphBots are currently listed for sale on OpenSea."
    );
  }

  const listingLines = listings.slice(0, DISPLAY_LIMIT).map((listing, i) => {
    const price = formatEthAmount(
      listing.price.current.value,
      listing.price.current.decimals
    );
    const seller = shortAddress(listing.protocol_data.parameters.offerer);

    return `**${i + 1}.** ${price}\n└ Seller: \`${seller}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.listing)
    .setTitle("🏷️ Cheapest GlyphBots For Sale")
    .setDescription(listingLines.join("\n\n"))
    .setFooter({ text: "Data from OpenSea • Prices may change" })
    .setTimestamp();

  return embedReply(embed, [
    linkButtonRow([
      { label: "Browse on OpenSea", url: getOpenSeaCollectionUrl(), emoji: "🛒" },
    ]),
  ]);
};
