import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { getBotUrl } from "../api/glyphbots";
import {
  fetchCollectionEvents,
  getOpenSeaCollectionUrl,
  shortAddress,
} from "../api/opensea";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("SalesCmd");

const SALE_COLOR: HexColorString = "#2ecc71";
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
  return `${Math.floor(seconds / 86_400)}d ago`;
};

export const handleSales = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  await interaction.deferReply();

  const events = await fetchCollectionEvents("sale", 10);

  if (events.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("📉 No Recent Sales")
      .setDescription("No sales found in the GlyphBots collection recently.");

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const saleLines = events.slice(0, 8).map((event, i) => {
    const tokenId = event.nft?.identifier ?? "?";
    const name = event.nft?.name ?? `GlyphBot #${tokenId}`;
    const price = event.payment
      ? formatETH(event.payment.quantity, event.payment.decimals)
      : "?";
    const time = formatTimeAgo(event.event_timestamp);
    const buyer = event.buyer ? shortAddress(event.buyer) : "?";

    return `**${i + 1}.** [${name}](${getBotUrl(Number(tokenId))}) → ${price} (${time})\n└ Buyer: \`${buyer}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(SALE_COLOR)
    .setTitle("💰 Recent GlyphBots Sales")
    .setDescription(saleLines.join("\n\n"))
    .setFooter({ text: "Data from OpenSea" })
    .setTimestamp();

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("View on OpenSea")
      .setStyle(ButtonStyle.Link)
      .setURL(getOpenSeaCollectionUrl())
      .setEmoji("🌊")
  );

  await interaction.editReply({ embeds: [embed], components: [buttons] });
  log.info(`Displayed ${events.length} recent sales`);
};
