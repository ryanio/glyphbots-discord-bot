/**
 * `/activity`.
 *
 * The event list is OpenSea data, but the thumbnail is the first-party PNG,
 * which is what it must be: the `image_url` OpenSea returns for this contract
 * is SVG and Discord renders nothing for it.
 */

import { EmbedBuilder } from "@discordjs/builders";
import type { DisplayNameResolver } from "../api/display-name";
import { createDisplayNameResolver } from "../api/display-name";
import { getOpenSeaUrl } from "../api/opensea";
import type { OpenSeaEvent } from "../api/types";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply, formatActor } from "../discord/embeds";
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

/**
 * One line. `names` is shared across the whole reply, so a bot that changed
 * hands between the same two wallets four times costs two lookups rather than
 * eight.
 */
const formatEventLine = async (
  event: OpenSeaEvent,
  names: DisplayNameResolver
): Promise<string> => {
  const emoji = getEventEmoji(event.event_type);
  const time = formatTimeAgo(event.event_timestamp);
  const price = event.payment
    ? formatEthAmount(event.payment.quantity, event.payment.decimals)
    : "?";
  const actor = async (address: string | undefined): Promise<string> =>
    address ? formatActor(await names.resolve(address)) : "`?`";

  switch (event.event_type) {
    case "sale":
      return `${emoji} **Sold** for ${price} to ${await actor(event.buyer)} (${time})`;
    case "transfer":
      return `${emoji} **Transferred** to ${await actor(event.to_address)} (${time})`;
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

  // Truthy, not nullish: OpenSea sends `name: ""` for a token it has not
  // finished indexing, which left the title reading "📊 Activity: ".
  const nftName = events[0]?.nft?.name || `GlyphBot #${tokenId}`;

  const names = createDisplayNameResolver(ctx.opensea);
  const lines: string[] = [];
  for (const event of events.slice(0, DISPLAY_LIMIT)) {
    lines.push(await formatEventLine(event, names));
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.activity)
    .setTitle(`📊 Activity: ${nftName}`)
    .setDescription(lines.join("\n"))
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
