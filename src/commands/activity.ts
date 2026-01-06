import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { getBotPngUrl, getBotUrl } from "../api/glyphbots";
import { fetchNFTEvents, getOpenSeaUrl, shortAddress } from "../api/opensea";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("ActivityCmd");

const ACTIVITY_COLOR: HexColorString = "#e67e22";
const ERROR_COLOR: HexColorString = "#ff4444";

const formatETH = (quantity: string, decimals: number): string => {
  const value = Number(quantity) / 10 ** decimals;
  if (value < 0.0001) {
    return `${value.toExponential(2)} ETH`;
  }
  if (value < 1) {
    return `${value.toFixed(4)} ETH`;
  }
  return `${value.toFixed(3)} ETH`;
};

const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
};

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

const formatEventLine = (event: {
  event_type: string;
  event_timestamp: number;
  payment?: { quantity: string; decimals: number };
  seller?: string;
  buyer?: string;
  from_address?: string;
  to_address?: string;
}): string => {
  const emoji = getEventEmoji(event.event_type);
  const time = formatTimeAgo(event.event_timestamp);

  switch (event.event_type) {
    case "sale": {
      const price = event.payment
        ? formatETH(event.payment.quantity, event.payment.decimals)
        : "?";
      const buyer = event.buyer ? shortAddress(event.buyer) : "?";
      return `${emoji} **Sold** for ${price} to \`${buyer}\` (${time})`;
    }
    case "transfer": {
      const to = event.to_address ? shortAddress(event.to_address) : "?";
      return `${emoji} **Transferred** to \`${to}\` (${time})`;
    }
    case "listing":
    case "order": {
      const price = event.payment
        ? formatETH(event.payment.quantity, event.payment.decimals)
        : "?";
      return `${emoji} **Listed** for ${price} (${time})`;
    }
    default:
      return `${emoji} **${event.event_type}** (${time})`;
  }
};

export const handleActivity = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const tokenId = interaction.options.getInteger("bot", true);

  await interaction.deferReply();

  const events = await fetchNFTEvents(tokenId, 10);

  if (events.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("📋 No Activity Found")
      .setDescription(`No recent activity found for GlyphBot #${tokenId}.`);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const nftName = events[0]?.nft?.name ?? `GlyphBot #${tokenId}`;

  const eventLines = events.slice(0, 8).map(formatEventLine);

  const embed = new EmbedBuilder()
    .setColor(ACTIVITY_COLOR)
    .setTitle(`📊 Activity: ${nftName}`)
    .setDescription(eventLines.join("\n"))
    .setThumbnail(getBotPngUrl(tokenId))
    .setFooter({ text: "Data from OpenSea" })
    .setTimestamp();

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("View Bot")
      .setStyle(ButtonStyle.Link)
      .setURL(getBotUrl(tokenId))
      .setEmoji("🤖"),
    new ButtonBuilder()
      .setLabel("View on OpenSea")
      .setStyle(ButtonStyle.Link)
      .setURL(getOpenSeaUrl(tokenId))
      .setEmoji("🌊")
  );

  await interaction.editReply({ embeds: [embed], components: [buttons] });
  log.info(`Activity lookup for #${tokenId}: ${events.length} events`);
};
