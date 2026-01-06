import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { getBotPngUrl, getBotUrl } from "../api/glyphbots";
import { fetchNFT, getOpenSeaUrl } from "../api/opensea";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("RarityCmd");

const RARITY_COLOR: HexColorString = "#9b59b6";
const ERROR_COLOR: HexColorString = "#ff4444";

const MAX_SUPPLY = 11_111;

const getRarityEmoji = (rank: number): string => {
  const percentile = (rank / MAX_SUPPLY) * 100;
  if (percentile <= 1) {
    return "🏆";
  }
  if (percentile <= 5) {
    return "💎";
  }
  if (percentile <= 10) {
    return "🥇";
  }
  if (percentile <= 25) {
    return "🥈";
  }
  if (percentile <= 50) {
    return "🥉";
  }
  return "⭐";
};

const getRarityTier = (rank: number): string => {
  const percentile = (rank / MAX_SUPPLY) * 100;
  if (percentile <= 1) {
    return "Legendary (Top 1%)";
  }
  if (percentile <= 5) {
    return "Epic (Top 5%)";
  }
  if (percentile <= 10) {
    return "Rare (Top 10%)";
  }
  if (percentile <= 25) {
    return "Uncommon (Top 25%)";
  }
  if (percentile <= 50) {
    return "Common (Top 50%)";
  }
  return "Standard";
};

export const handleRarity = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const tokenId = interaction.options.getInteger("bot", true);

  await interaction.deferReply();

  const nft = await fetchNFT(tokenId);

  if (!nft) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("❌ Bot Not Found")
      .setDescription(`GlyphBot #${tokenId} was not found.`);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const botName = nft.name ?? `GlyphBot #${tokenId}`;
  const rank = nft.rarity?.rank ?? 0;
  const emoji = getRarityEmoji(rank);
  const tier = getRarityTier(rank);

  const traitLines: string[] = [];
  if (nft.traits) {
    const displayTraits = nft.traits.filter(
      (t) =>
        !["Name"].includes(t.trait_type) &&
        t.value !== "None" &&
        t.value !== "No"
    );

    for (const trait of displayTraits.slice(0, 8)) {
      traitLines.push(`**${trait.trait_type}:** ${trait.value}`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(RARITY_COLOR)
    .setTitle(`${emoji} ${botName}`)
    .setDescription(
      [
        `**Rarity Rank:** #${rank.toLocaleString()} / ${MAX_SUPPLY.toLocaleString()}`,
        `**Tier:** ${tier}`,
        "",
        traitLines.length > 0 ? "**Traits:**" : "",
        ...traitLines,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setThumbnail(getBotPngUrl(tokenId))
    .setFooter({ text: "Rarity calculated by OpenRarity" });

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
  log.info(`Rarity lookup for #${tokenId}: rank ${rank}`);
};
