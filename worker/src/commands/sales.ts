/**
 * `/sales`.
 *
 * Bot links point at glyphbots.com rather than OpenSea's asset page, exactly
 * as the original did. Nothing here sets an image, so there is no SVG hazard.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { createDisplayNameResolver } from "../api/display-name";
import { getOpenSeaCollectionUrl } from "../api/opensea";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply, formatActor } from "../discord/embeds";
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

  // One resolver for the whole reply. Recent sales are often one sweeper
  // buying eight times, which is then one account lookup rather than eight.
  const names = createDisplayNameResolver(ctx.opensea);
  const saleLines: string[] = [];

  for (const [i, event] of events.slice(0, DISPLAY_LIMIT).entries()) {
    const rawTokenId = event.nft?.identifier;
    // `getBotUrl(Number(undefined))` and `getBotUrl(Number("?"))` both produce
    // `/bot/NaN`, a link to a 404. Without a usable id the item is named but
    // not linked.
    const linkable =
      rawTokenId !== undefined && Number.isFinite(Number(rawTokenId));
    // Truthy, not nullish: OpenSea sends `name: ""` for a token it has not
    // finished indexing, and an empty name leaves a bare arrow on the line.
    const name =
      event.nft?.name || (linkable ? `GlyphBot #${rawTokenId}` : "GlyphBot");
    const price = event.payment
      ? formatEthAmount(event.payment.quantity, event.payment.decimals)
      : "?";
    const time = formatTimeAgo(event.event_timestamp);
    const buyer = event.buyer
      ? formatActor(await names.resolve(event.buyer))
      : "`?`";
    const item = linkable
      ? `[${name}](${ctx.glyphbots.getBotUrl(Number(rawTokenId))})`
      : name;

    saleLines.push(
      `**${i + 1}.** ${item} → ${price} (${time})\n└ Buyer: ${buyer}`
    );
  }

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
