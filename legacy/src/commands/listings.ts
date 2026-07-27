import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import {
  fetchListings,
  getOpenSeaCollectionUrl,
  shortAddress,
} from "../api/opensea";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("ListingsCmd");

const LISTING_COLOR: HexColorString = "#3498db";
const ERROR_COLOR: HexColorString = "#ff4444";

const formatETH = (value: string, decimals: number): string => {
  const num = Number(value) / 10 ** decimals;
  if (num < 0.0001) {
    return `${num.toExponential(2)} ETH`;
  }
  if (num < 1) {
    return `${num.toFixed(4)} ETH`;
  }
  return `${num.toFixed(3)} ETH`;
};

export const handleListings = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  await interaction.deferReply();

  const listings = await fetchListings(10);

  if (listings.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("📋 No Active Listings")
      .setDescription("No GlyphBots are currently listed for sale on OpenSea.");

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const listingLines = listings.slice(0, 8).map((listing, i) => {
    const price = formatETH(
      listing.price.current.value,
      listing.price.current.decimals
    );
    const seller = shortAddress(listing.protocol_data.parameters.offerer);

    return `**${i + 1}.** ${price}\n└ Seller: \`${seller}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(LISTING_COLOR)
    .setTitle("🏷️ Cheapest GlyphBots For Sale")
    .setDescription(listingLines.join("\n\n"))
    .setFooter({ text: "Data from OpenSea • Prices may change" })
    .setTimestamp();

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Browse on OpenSea")
      .setStyle(ButtonStyle.Link)
      .setURL(getOpenSeaCollectionUrl())
      .setEmoji("🛒")
  );

  await interaction.editReply({ embeds: [embed], components: [buttons] });
  log.info(`Displayed ${listings.length} listings`);
};
