import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { getBotPngUrl, getBotUrl } from "../api/glyphbots";
import {
  fetchAccount,
  fetchNFT,
  getOpenSeaUrl,
  shortAddress,
} from "../api/opensea";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("OwnerCmd");

const INFO_COLOR: HexColorString = "#5865f2";
const ERROR_COLOR: HexColorString = "#ff4444";

export const handleOwner = async (
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

  const owner = nft.owners?.[0];
  if (!owner) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("❌ Owner Not Found")
      .setDescription(`Could not determine the owner of GlyphBot #${tokenId}.`);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const account = await fetchAccount(owner.address);
  const displayName = account?.username || shortAddress(owner.address);
  const botName = nft.name ?? `GlyphBot #${tokenId}`;

  const embed = new EmbedBuilder()
    .setColor(INFO_COLOR)
    .setTitle(`🤖 ${botName}`)
    .setDescription(
      [
        `**Owner:** ${account?.username ? `@${account.username}` : displayName}`,
        `**Address:** \`${shortAddress(owner.address)}\``,
        "",
        account?.bio ? `*"${account.bio}"*` : "",
        "",
        nft.rarity
          ? `**Rarity Rank:** #${nft.rarity.rank.toLocaleString()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setThumbnail(getBotPngUrl(tokenId))
    .setFooter({ text: "Data from OpenSea" });

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
  log.info(`Owner lookup for #${tokenId}: ${displayName}`);
};
