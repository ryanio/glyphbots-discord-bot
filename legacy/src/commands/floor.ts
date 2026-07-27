import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { fetchCollectionStats, getOpenSeaCollectionUrl } from "../api/opensea";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("FloorCmd");

const STATS_COLOR: HexColorString = "#f5a623";
const ERROR_COLOR: HexColorString = "#ff4444";

const formatETH = (value: number): string => {
  if (value === 0) {
    return "0 ETH";
  }
  if (value < 0.0001) {
    return `${value.toExponential(2)} ETH`;
  }
  if (value < 1) {
    return `${value.toFixed(4)} ETH`;
  }
  return `${value.toFixed(2)} ETH`;
};

const formatNumber = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString();
};

const formatPercentChange = (change: number): string => {
  if (change === 0) {
    return "—";
  }
  const sign = change > 0 ? "+" : "";
  return `${sign}${(change * 100).toFixed(1)}%`;
};

export const handleFloor = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  await interaction.deferReply();

  const stats = await fetchCollectionStats();

  if (!stats) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("❌ Error")
      .setDescription("Failed to fetch GlyphBots collection stats.");

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const { total, intervals } = stats;
  const oneDay = intervals.find((i) => i.interval === "one_day");
  const sevenDay = intervals.find((i) => i.interval === "seven_day");
  const thirtyDay = intervals.find((i) => i.interval === "thirty_day");

  const embed = new EmbedBuilder()
    .setColor(STATS_COLOR)
    .setTitle("📊 GlyphBots Collection Stats")
    .addFields(
      {
        name: "💎 Floor Price",
        value: formatETH(total.floor_price),
        inline: true,
      },
      {
        name: "👥 Owners",
        value: formatNumber(total.num_owners),
        inline: true,
      },
      {
        name: "📈 Total Volume",
        value: formatETH(total.volume),
        inline: true,
      },
      {
        name: "🔄 24h Volume",
        value: oneDay ? formatETH(oneDay.volume) : "—",
        inline: true,
      },
      {
        name: "📊 24h Sales",
        value: oneDay ? formatNumber(oneDay.sales) : "—",
        inline: true,
      },
      {
        name: "📈 7d Change",
        value: sevenDay ? formatPercentChange(sevenDay.volume_change) : "—",
        inline: true,
      },
      {
        name: "🏷️ Avg Price",
        value: formatETH(total.average_price),
        inline: true,
      },
      {
        name: "📊 Total Sales",
        value: formatNumber(total.sales),
        inline: true,
      },
      {
        name: "📈 30d Sales",
        value: thirtyDay ? formatNumber(thirtyDay.sales) : "—",
        inline: true,
      }
    )
    .setFooter({ text: "Data from OpenSea" })
    .setTimestamp();

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("View on OpenSea")
      .setStyle(ButtonStyle.Link)
      .setURL(getOpenSeaCollectionUrl())
      .setEmoji("🌊"),
    new ButtonBuilder()
      .setLabel("Mint a GlyphBot")
      .setStyle(ButtonStyle.Link)
      .setURL("https://glyphbots.com")
      .setEmoji("🤖")
  );

  await interaction.editReply({ embeds: [embed], components: [buttons] });
  log.info("Floor stats displayed");
};
