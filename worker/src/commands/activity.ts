/**
 * `/activity`.
 *
 * The event list is OpenSea data, but the thumbnail is the first-party PNG,
 * which is what it must be: the `image_url` OpenSea returns for this contract
 * is SVG and Discord renders nothing for it.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { shortAddress } from "../api/glyphbots";
import { getOpenSeaUrl } from "../api/opensea";
import type { OpenSeaEvent } from "../api/types";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply } from "../discord/embeds";
import type { CommandHandler } from "./context";
import { formatEthAmount, formatTimeAgo } from "./format";

const FETCH_LIMIT = 10;
const DISPLAY_LIMIT = 8;

const getEventEmoji = (eventType: string): string => {
  switch (eventType) {
    case "sale":
      return "💰";
    case "transfer":
      return "📦";
    case "listing":
    case "order":
      return "🏷️";
    default:
      return "📋";
  }
};

const formatEventLine = (event: OpenSeaEvent): string => {
  const emoji = getEventEmoji(event.event_type);
  const time = formatTimeAgo(event.event_timestamp);
  const price = event.payment
    ? formatEthAmount(event.payment.quantity, event.payment.decimals)
    : "?";

  switch (event.event_type) {
    case "sale": {
      const buyer = event.buyer ? shortAddress(event.buyer) : "?";
      return `${emoji} **Sold** for ${price} to \`${buyer}\` (${time})`;
    }
    case "transfer": {
      const to = event.to_address ? shortAddress(event.to_address) : "?";
      return `${emoji} **Transferred** to \`${to}\` (${time})`;
    }
    case "listing":
    case "order":
      return `${emoji} **Listed** for ${price} (${time})`;
    default:
      return `${emoji} **${event.event_type}** (${time})`;
  }
};

export const handleActivity: CommandHandler = async (ctx) => {
  const tokenId = ctx.options.getInteger("bot");

  if (tokenId === null) {
    return errorReply("❌ Missing Bot ID", "Please provide a bot token id.");
  }

  const events = await ctx.opensea.fetchNFTEvents(tokenId, FETCH_LIMIT);

  if (events.length === 0) {
    return errorReply(
      "📋 No Activity Found",
      `No recent activity found for GlyphBot #${tokenId}.`
    );
  }

  const nftName = events[0]?.nft?.name ?? `GlyphBot #${tokenId}`;

  const embed = new EmbedBuilder()
    .setColor(COLORS.activity)
    .setTitle(`📊 Activity: ${nftName}`)
    .setDescription(
      events.slice(0, DISPLAY_LIMIT).map(formatEventLine).join("\n")
    )
    .setThumbnail(ctx.glyphbots.getBotPngUrl(tokenId))
    .setFooter({ text: "Data from OpenSea" })
    .setTimestamp();

  return embedReply(embed, [
    linkButtonRow([
      { label: "View Bot", url: ctx.glyphbots.getBotUrl(tokenId), emoji: "🤖" },
      { label: "View on OpenSea", url: getOpenSeaUrl(tokenId), emoji: "🌊" },
    ]),
  ]);
};
