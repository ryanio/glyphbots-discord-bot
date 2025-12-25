/**
 * /info Command Handler
 *
 * Provides bot and artifact information lookups.
 */

import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import {
  fetchArtifact,
  fetchBot,
  fetchBotStory,
  getArtifactUrl,
  getBotUrl,
} from "../api/glyphbots";
import type { Bot, BotStory } from "../lib/types";

/** GlyphBots brand color */
const GLYPHBOTS_COLOR: HexColorString = "#00ff88";

/** Error color */
const ERROR_COLOR: HexColorString = "#ff4444";

/** Bot start time for uptime calculation */
const startTime = Date.now();

/**
 * Format stats as a bar
 */
const statsBar = (value: number): string => {
  const filled = Math.floor(value / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
};

/** Format stats block for embed */
const formatStatsBlock = (stats: BotStory["storyStats"]): string => {
  if (!stats) {
    return "";
  }
  const statLines = [
    `STR ${statsBar(stats.strength ?? 0)} ${stats.strength ?? 0}`,
    `AGI ${statsBar(stats.agility ?? 0)} ${stats.agility ?? 0}`,
    `INT ${statsBar(stats.intellect ?? 0)} ${stats.intellect ?? 0}`,
    `LCK ${statsBar(stats.luck ?? 0)} ${stats.luck ?? 0}`,
    `END ${statsBar(stats.endurance ?? 0)} ${stats.endurance ?? 0}`,
    `CHA ${statsBar(stats.charisma ?? 0)} ${stats.charisma ?? 0}`,
  ];
  return `\`\`\`\n${statLines.join("\n")}\n\`\`\``;
};

/** Add story info to embed */
const addStoryToEmbed = (embed: EmbedBuilder, story: BotStory): void => {
  embed.addFields({
    name: "⚔ Role ⚔",
    value: `${story.arc.faction}\n${story.arc.role}`,
    inline: true,
  });

  if (story.storyStats) {
    embed.addFields({
      name: "◉ Stats ◉",
      value: formatStatsBlock(story.storyStats),
    });
  }

  if (story.storyPowers && story.storyPowers.length > 0) {
    embed.addFields({
      name: "⚡ Powers ⚡",
      value: story.storyPowers.slice(0, 3).join(" • "),
    });
  }
};

/**
 * Build bot info embed
 */
const buildBotEmbed = (bot: Bot, story: BotStory | null): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(GLYPHBOTS_COLOR)
    .setTitle(`▸ ${bot.name} • #${bot.tokenId}`)
    .setURL(getBotUrl(bot.tokenId));

  // Add traits
  if (bot.traits.length > 0) {
    const traitList = bot.traits
      .slice(0, 6)
      .map((t) => `**${t.trait_type}:** ${t.value}`)
      .join("\n");
    embed.addFields({ name: "◉ Traits", value: traitList, inline: true });
  }

  // Add story info if available
  if (story) {
    addStoryToEmbed(embed, story);
  }

  embed.addFields({
    name: "✦ Rarity ✦",
    value: `#${bot.rarityRank} of 11,111`,
    inline: true,
  });

  embed.setFooter({ text: "GlyphBots • View on glyphbots.com" });

  return embed;
};

/**
 * Build artifact info embed
 */
const buildArtifactEmbed = (artifact: {
  id: string;
  title: string;
  contractTokenId: number | null;
  imageUrl: string;
  mintedAt: string | null;
  botTokenId: number;
}): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(GLYPHBOTS_COLOR)
    .setTitle(`▸ ${artifact.title}`);

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

  embed.setFooter({ text: "GlyphBots Artifacts • View on glyphbots.com" });

  return embed;
};

/**
 * Build about/stats embed
 */
const buildAboutEmbed = (): EmbedBuilder => {
  const uptime = Date.now() - startTime;
  const hours = Math.floor(uptime / (1000 * 60 * 60));
  const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));

  return new EmbedBuilder()
    .setColor(GLYPHBOTS_COLOR)
    .setTitle("▸ GlyphBots Discord Bot")
    .setDescription(
      "AI-powered Discord bot for the GlyphBots community featuring lore narratives, arena battles, and playground content."
    )
    .addFields(
      {
        name: "⏱ Uptime",
        value: `${hours}h ${minutes}m`,
        inline: true,
      },
      {
        name: "▶ AI",
        value: "Google Gemini",
        inline: true,
      },
      {
        name: "◉ Version",
        value: "2.0.0",
        inline: true,
      }
    )
    .addFields({
      name: "▸ Channels",
      value:
        "▸ **#lore** - AI-generated narratives\n▸ **#arena** - PvP battles\n▸ **#playground** - Community content",
    })
    .setFooter({ text: "GlyphBots • glyphbots.com" });
};

/**
 * Handle /info command
 */
export const handleInfo = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "bot": {
      const tokenId = interaction.options.getInteger("id", true);
      await interaction.deferReply();

      const bot = await fetchBot(tokenId);
      if (!bot) {
        const errorEmbed = new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setTitle("▸ Bot Not Found")
          .setDescription(`Bot #${tokenId} could not be found.`);
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      const story = await fetchBotStory(tokenId);
      const embed = buildBotEmbed(bot, story);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "artifact": {
      const tokenId = interaction.options.getInteger("id", true);
      await interaction.deferReply();

      const artifact = await fetchArtifact(tokenId);
      if (!artifact) {
        const errorEmbed = new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setTitle("▸ Artifact Not Found")
          .setDescription(`Artifact #${tokenId} could not be found.`);
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      const embed = buildArtifactEmbed(artifact);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "about": {
      const embed = buildAboutEmbed();
      await interaction.reply({ embeds: [embed] });
      return;
    }

    default: {
      await interaction.reply({
        content: "Unknown subcommand.",
        ephemeral: true,
      });
    }
  }
};
