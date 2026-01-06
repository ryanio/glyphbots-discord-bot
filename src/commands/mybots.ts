import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { getBotPngUrl, getBotUrl } from "../api/glyphbots";
import { fetchAccountNFTs, shortAddress } from "../api/opensea";
import { prefixedLogger } from "../lib/logger";
import type { AccountNFT } from "../lib/types";
import { getUserWallet } from "../lib/wallet-state";

const log = prefixedLogger("MyBotsCmd");

const BOT_COLOR: HexColorString = "#00d4aa";
const INFO_COLOR: HexColorString = "#5865f2";
const BOTS_PER_PAGE = 10;

const formatBotLine = (nft: AccountNFT, index: number): string => {
  const tokenId = Number(nft.identifier);
  const name = nft.name ?? `GlyphBot #${tokenId}`;
  return `**${index + 1}.** [${name}](${getBotUrl(tokenId)})`;
};

export const handleMyBots = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const userId = interaction.user.id;
  const wallet = await getUserWallet(userId);

  if (!wallet) {
    const embed = new EmbedBuilder()
      .setColor(INFO_COLOR)
      .setTitle("🔗 Connect Your Wallet First")
      .setDescription(
        [
          "To see your GlyphBots, you need to connect your Ethereum wallet.",
          "",
          "**How to connect:**",
          "1. Use `/wallet set` with your Ethereum address",
          "2. Your GlyphBots will appear here!",
          "",
          "💡 *Your wallet address is public on the blockchain, so it's safe to share.*",
        ].join("\n")
      )
      .setFooter({ text: "Tip: Use /wallet set <address> to get started" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const nfts = await fetchAccountNFTs(wallet);

  if (nfts.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(INFO_COLOR)
      .setTitle("🤖 No GlyphBots Found")
      .setDescription(
        [
          `No GlyphBots found in wallet \`${shortAddress(wallet)}\`.`,
          "",
          "[🛒 Get a GlyphBot on OpenSea](https://opensea.io/collection/glyphbots)",
          "",
          "💡 *If you recently acquired a GlyphBot, it may take a few minutes to appear.*",
        ].join("\n")
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const botLines = nfts.slice(0, BOTS_PER_PAGE).map(formatBotLine);
  const moreCount = Math.max(0, nfts.length - BOTS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle(`🤖 Your GlyphBots (${nfts.length})`)
    .setDescription(
      [botLines.join("\n"), moreCount > 0 ? `\n*...and ${moreCount} more*` : ""]
        .filter(Boolean)
        .join("\n")
    )
    .setFooter({
      text: "Use /arena challenge to battle with one of your bots!",
    });

  if (nfts.length > 0) {
    const firstBot = nfts[0];
    const tokenId = Number(firstBot.identifier);
    embed.setThumbnail(getBotPngUrl(tokenId));
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("View on OpenSea")
      .setStyle(ButtonStyle.Link)
      .setURL("https://opensea.io/collection/glyphbots")
      .setEmoji("🌊")
  );

  await interaction.editReply({ embeds: [embed], components: [buttons] });
  log.info(`Listed ${nfts.length} bots for ${interaction.user.username}`);
};
