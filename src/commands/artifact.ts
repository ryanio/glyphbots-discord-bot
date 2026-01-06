import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import {
  fetchArtifact,
  fetchBot,
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../api/glyphbots";
import { prefixedLogger } from "../lib/logger";
import type { Artifact } from "../lib/types";

const log = prefixedLogger("ArtifactCmd");

const ARTIFACT_COLOR: HexColorString = "#9b59b6";
const ERROR_COLOR: HexColorString = "#ff4444";
const ARTIFACT_CONTRACT = "0x3c64dc415de60ee9a25f67fb48e7c9a234a4b6d1";
const BOT_NAME_REGEX = /^GlyphBot #\d+ - /;

const buildArtifactEmbed = async (
  artifact: Artifact
): Promise<EmbedBuilder> => {
  const embed = new EmbedBuilder()
    .setColor(ARTIFACT_COLOR)
    .setTitle(artifact.title);

  if (artifact.contractTokenId) {
    embed.setURL(getArtifactUrl(artifact.contractTokenId));
    embed.addFields({
      name: "Token ID",
      value: `#${artifact.contractTokenId}`,
      inline: true,
    });
  }

  if (artifact.type) {
    embed.addFields({
      name: "Type",
      value: artifact.type.charAt(0).toUpperCase() + artifact.type.slice(1),
      inline: true,
    });
  }

  // Fetch origin bot name
  const originBot = await fetchBot(artifact.botTokenId);
  const botName =
    originBot?.name?.replace(BOT_NAME_REGEX, "") ?? `#${artifact.botTokenId}`;

  embed.addFields({
    name: "Origin Bot",
    value: `[${botName}](${getBotUrl(artifact.botTokenId)})`,
    inline: true,
  });

  if (artifact.mintedAt) {
    const mintDate = new Date(artifact.mintedAt);
    embed.addFields({
      name: "Minted",
      value: mintDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      inline: true,
    });
  }

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  embed.setFooter({ text: "GlyphBots Artifacts" });

  return embed;
};

const getOpenSeaArtifactUrl = (tokenId: number): string =>
  `https://opensea.io/assets/ethereum/${ARTIFACT_CONTRACT}/${tokenId}`;

export const handleArtifact = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const tokenIdOption = interaction.options.getInteger("id");
  const isRandom = interaction.options.getBoolean("random") ?? false;

  await interaction.deferReply();

  let artifact: Artifact | null = null;

  if (isRandom) {
    // Fetch a random recent artifact
    const recentArtifacts = await fetchRecentArtifacts(50);
    if (recentArtifacts.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(ERROR_COLOR)
        .setTitle("No Artifacts Found")
        .setDescription("No recent artifacts could be found.");
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const randomIndex = Math.floor(Math.random() * recentArtifacts.length);
    artifact = recentArtifacts[randomIndex];
    log.info(
      `Random artifact: ${artifact.title} (#${artifact.contractTokenId})`
    );
  } else if (tokenIdOption) {
    artifact = await fetchArtifact(tokenIdOption);
    if (!artifact) {
      const embed = new EmbedBuilder()
        .setColor(ERROR_COLOR)
        .setTitle("Artifact Not Found")
        .setDescription(`Artifact #${tokenIdOption} could not be found.`);
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  } else {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("Missing Artifact ID")
      .setDescription("Please provide an artifact ID or use `random:true`.");
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const embed = await buildArtifactEmbed(artifact);

  const buttons: ButtonBuilder[] = [];

  if (artifact.contractTokenId) {
    buttons.push(
      new ButtonBuilder()
        .setLabel("View Artifact")
        .setStyle(ButtonStyle.Link)
        .setURL(getArtifactUrl(artifact.contractTokenId))
        .setEmoji("✨"),
      new ButtonBuilder()
        .setLabel("OpenSea")
        .setStyle(ButtonStyle.Link)
        .setURL(getOpenSeaArtifactUrl(artifact.contractTokenId))
        .setEmoji("🌊")
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setLabel("Origin Bot")
      .setStyle(ButtonStyle.Link)
      .setURL(getBotUrl(artifact.botTokenId))
      .setEmoji("🤖")
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

  await interaction.editReply({ embeds: [embed], components: [row] });
  log.info(`Displayed artifact: ${artifact.title}`);
};
