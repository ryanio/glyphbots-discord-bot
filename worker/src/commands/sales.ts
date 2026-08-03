/**
 * `/sales`.
 *
 * Bot links point at glyphbots.com rather than OpenSea's asset page, exactly
 * as the original did. Nothing here sets an image, so there is no SVG hazard.
 *
 * Each line carries the bot's rarity rank, because a price on its own does not
 * say whether it was a good one. Every rank on the reply comes from a single
 * request; see `../api/rarity-ranks.ts` for why that source and not OpenSea's.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { createDisplayNameResolver } from "../api/display-name";
import { getOpenSeaCollectionUrl } from "../api/opensea";
import { createRarityRanks } from "../api/rarity-ranks";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply, formatActor } from "../discord/embeds";
import type { CommandHandler } from "./context";
import { formatEthAmount, formatTimeAgo } from "./format";
import { rarityBadge } from "./rarity";

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
  const shown = events.slice(0, DISPLAY_LIMIT);

  // One request for every rank on the reply, before the loop rather than
  // inside it. An event with no readable token id contributes NaN, which is
  // filtered out rather than asked about.
  const ranks = await createRarityRanks(ctx.glyphbots).ranks(
    shown.map((event) => Number(event.nft?.identifier))
  );

  const saleLines: string[] = [];

  for (const [i, event] of shown.entries()) {
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

    // Unranked, unknown or burned tokens print no badge at all rather than a
    // placeholder. The rank is context for the price, not a field to fill.
    const rank = linkable ? ranks.get(Number(rawTokenId)) : undefined;
    const rarity = rank === undefined ? "" : ` · ${rarityBadge(rank)}`;

    saleLines.push(
      `**${i + 1}.** ${item} → ${price} (${time})\n└ Buyer: ${buyer}${rarity}`
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
