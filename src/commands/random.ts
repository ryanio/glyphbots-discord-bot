/**
 * /random Command Handler
 *
 * Get a random bot, artifact, or world showcase.
 */

import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import {
  fetchBot,
  fetchBotStory,
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../api/glyphbots";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("RandomCmd");

/** Brand colors */
const BOT_COLOR: HexColorString = "#00ff88";
const ARTIFACT_COLOR: HexColorString = "#ffaa00";
const WORLD_COLOR: HexColorString = "#66ccff";

/** Stats bar helper */
const statsBar = (value: number): string => {
  const filled = Math.floor(value / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
};

/**
 * Handle /random bot
 */
const handleRandomBot = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  await interaction.deferReply();

  const tokenId = Math.floor(Math.random() * 11_111) + 1;
  log.info(`Random bot requested: #${tokenId}`);

  const bot = await fetchBot(tokenId);
  if (!bot) {
    await interaction.editReply({
      content: `◈ Failed to fetch bot #${tokenId}. Please try again.`,
    });
    return;
  }

  const story = await fetchBotStory(tokenId);

  const embed = new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle(`◈ ${bot.name} • #${tokenId} ◈`)
    .setURL(getBotUrl(tokenId));

  if (bot.traits.length > 0) {
    const traitList = bot.traits
      .slice(0, 4)
      .map((t) => `**${t.trait_type}:** ${t.value}`)
      .join("\n");
    embed.addFields({ name: "◉ Traits ◉", value: traitList, inline: true });
  }

  if (story) {
    embed.addFields({
      name: "⚔ Role ⚔",
      value: `${story.arc.faction}\n${story.arc.role}`,
      inline: true,
    });

    const stats = story.storyStats;
    if (stats) {
      const statLines = [
        `STR ${statsBar(stats.strength ?? 0)} ${stats.strength ?? 0}`,
        `AGI ${statsBar(stats.agility ?? 0)} ${stats.agility ?? 0}`,
        `INT ${statsBar(stats.intellect ?? 0)} ${stats.intellect ?? 0}`,
      ];
      embed.addFields({
        name: "◉ Stats ◉",
        value: `\`\`\`\n${statLines.join("\n")}\n\`\`\``,
      });
    }
  }

  embed.addFields({
    name: "✦ Rarity ✦",
    value: `#${bot.rarityRank} of 11,111`,
    inline: true,
  });

  embed.setFooter({ text: "◈ Use /random bot again for another! ◈" });

  await interaction.editReply({ embeds: [embed] });
};

/**
 * Handle /random artifact
 */
const handleRandomArtifact = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  await interaction.deferReply();

  log.info("Random artifact requested");

  const artifacts = await fetchRecentArtifacts(100);
  if (artifacts.length === 0) {
    await interaction.editReply({
      content: "◈ No artifacts available. Please try again later.",
    });
    return;
  }

  const artifact = artifacts[Math.floor(Math.random() * artifacts.length)];

  const embed = new EmbedBuilder()
    .setColor(ARTIFACT_COLOR)
    .setTitle(`◈ ${artifact.title} ◈`);

  if (artifact.contractTokenId) {
    embed.setURL(getArtifactUrl(artifact.contractTokenId));
    embed.addFields({
      name: "Token ID",
      value: `#${artifact.contractTokenId}`,
      inline: true,
    });
  }

  embed.addFields({
    name: "Origin Bot",
    value: `[#${artifact.botTokenId}](${getBotUrl(artifact.botTokenId)})`,
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

  embed.setFooter({ text: "◈ Use /random artifact again for another! ◈" });

  await interaction.editReply({ embeds: [embed] });
};

/**
 * Handle /random world
 */
const handleRandomWorld = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  await interaction.deferReply();

  log.info("Random world requested");

  const artifacts = await fetchRecentArtifacts(100);
  const worldArtifacts = artifacts.filter(
    (a) =>
      a.title.toLowerCase().includes("world") ||
      a.title.toLowerCase().includes("realm") ||
      a.title.toLowerCase().includes("domain")
  );

  const pool = worldArtifacts.length > 0 ? worldArtifacts : artifacts;
  const artifact = pool[Math.floor(Math.random() * pool.length)];

  if (!artifact) {
    await interaction.editReply({
      content: "◈ No worlds available. Please try again later.",
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(WORLD_COLOR)
    .setTitle(`◈ ${artifact.title} ◈`)
    .setDescription(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n*A glimpse into another realm...*"
    );

  if (artifact.contractTokenId) {
    embed.setURL(getArtifactUrl(artifact.contractTokenId));
  }

  embed.addFields({
    name: "Origin Bot",
    value: `[#${artifact.botTokenId}](${getBotUrl(artifact.botTokenId)})`,
    inline: true,
  });

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  embed.setFooter({ text: "◈ Use /random world again for another! ◈" });

  await interaction.editReply({ embeds: [embed] });
};

/**
 * Handle /random command
 */
export const handleRandom = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const type = interaction.options.getString("type", true);

  switch (type) {
    case "bot":
      await handleRandomBot(interaction);
      break;
    case "artifact":
      await handleRandomArtifact(interaction);
      break;
    case "world":
      await handleRandomWorld(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown random type.",
        ephemeral: true,
      });
  }
};
