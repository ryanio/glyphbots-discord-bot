/**
 * `/sales`, ported from `src/commands/sales.ts`.
 *
 * Bot links point at glyphbots.com rather than OpenSea's asset page, exactly
 * as the original did. Nothing here sets an image, so there is no SVG hazard.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { shortAddress } from "../api/glyphbots";
import { getOpenSeaCollectionUrl } from "../api/opensea";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply } from "../discord/embeds";
import type { CommandHandler } from "./context";
import { formatEthAmount, formatTimeAgo } from "./format";

const FETCH_LIMIT = 10;
const DISPLAY_LIMIT = 8;

export const handleSales: CommandHandler = async (ctx) => {
  const events = await ctx.opensea.fetchCollectionEvents("sale", FETCH_LIMIT);

  if (events.length === 0) {
    return errorReply(
      "📉 No Recent Sales",
      "No sales found in the GlyphBots collection recently."
    );
  }

  const saleLines = events.slice(0, DISPLAY_LIMIT).map((event, i) => {
    const tokenId = event.nft?.identifier ?? "?";
    const name = event.nft?.name ?? `GlyphBot #${tokenId}`;
    const price = event.payment
      ? formatEthAmount(event.payment.quantity, event.payment.decimals)
      : "?";
    const time = formatTimeAgo(event.event_timestamp);
    const buyer = event.buyer ? shortAddress(event.buyer) : "?";
    const url = ctx.glyphbots.getBotUrl(Number(tokenId));

    return `**${i + 1}.** [${name}](${url}) → ${price} (${time})\n└ Buyer: \`${buyer}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.sale)
    .setTitle("💰 Recent GlyphBots Sales")
    .setDescription(saleLines.join("\n\n"))
    .setFooter({ text: "Data from OpenSea" })
    .setTimestamp();

  return embedReply(embed, [
    linkButtonRow([
      { label: "View on OpenSea", url: getOpenSeaCollectionUrl(), emoji: "🌊" },
    ]),
  ]);
};
