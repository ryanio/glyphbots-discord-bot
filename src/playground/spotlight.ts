/**
 * Bot Spotlight Content
 *
 * Features a random bot with full stats and lore.
 */

import {
  type ActionRowBuilder,
  type ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { fetchBot, fetchBotStory, getBotUrl } from "../api/glyphbots";
import { generateText } from "../api/google-ai";
import {
  createBotLinkButton,
  createButton,
  createButtonRowWithButtons,
} from "../lib/discord/buttons";
import { prefixedLogger } from "../lib/logger";
import type { BotStory } from "../lib/types";

const log = prefixedLogger("Spotlight");

/** Spotlight brand color */
const SPOTLIGHT_COLOR: HexColorString = "#ffaa00";

/** Stats bar helper */
const statsBar = (value: number): string => {
  const filled = Math.floor(value / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
};

/** Format stats block for spotlight */
const formatSpotlightStats = (stats: {
  strength?: number;
  agility?: number;
  intellect?: number;
  luck?: number;
  endurance?: number;
  charisma?: number;
}): string => {
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

/** Add story info to spotlight embed */
const addSpotlightStory = async (
  embed: EmbedBuilder,
  story: BotStory,
  botName: string
): Promise<void> => {
  embed.addFields({
    name: "⚔️ Identity",
    value: `${story.arc.faction}\n${story.arc.role}`,
    inline: true,
  });

  if (story.storyStats) {
    embed.addFields({
      name: "📊 Combat Stats",
      value: formatSpotlightStats(story.storyStats),
    });
  }

  if (story.storyPowers && story.storyPowers.length > 0) {
    embed.addFields({
      name: "⚡ Powers",
      value: story.storyPowers.join(" • "),
    });
  }

  const description = await generateSpotlightDescription(botName, story);
  if (description) {
    embed.addFields({
      name: "📜 About",
      value: description,
    });
  }
};

/**
 * Generate a bot spotlight embed with buttons
 */
export const generateSpotlight = async (): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} | null> => {
  // Random token ID between 1 and 11111
  const tokenId = Math.floor(Math.random() * 11_111) + 1;

  log.info(`Generating spotlight for bot #${tokenId}`);

  const bot = await fetchBot(tokenId);
  if (!bot) {
    log.warn(`Failed to fetch bot #${tokenId}`);
    return null;
  }

  const story = await fetchBotStory(tokenId);

  const embed = new EmbedBuilder()
    .setColor(SPOTLIGHT_COLOR)
    .setTitle(`🌟 BOT SPOTLIGHT: ${bot.name}`)
    .setURL(getBotUrl(tokenId))
    .setDescription(`✨ Today's featured GlyphBot from the collection!`);

  // Add traits
  if (bot.traits.length > 0) {
    const traitList = bot.traits
      .slice(0, 6)
      .map((t) => `**${t.trait_type}:** ${t.value}`)
      .join("\n");
    embed.addFields({ name: "🎨 Traits", value: traitList, inline: true });
  }

  // Add story info if available
  if (story) {
    await addSpotlightStory(embed, story, bot.name);
  }

  embed.addFields({
    name: "🏆 Rarity",
    value: `Ranked #${bot.rarityRank} of 11,111`,
    inline: true,
  });

  embed.setFooter({
    text: "🌟 Use /info bot to learn more about any GlyphBot!",
  });

  // Build buttons
  const buttons = createButtonRowWithButtons(
    createBotLinkButton(tokenId, "View Bot", `playground_view_bot_${tokenId}`),
    createButton(
      "playground_new_spotlight",
      "New Spotlight",
      ButtonStyle.Secondary,
      "✨"
    ),
    createButton(
      "playground_request_discovery",
      "Request Discovery",
      ButtonStyle.Secondary,
      "🎒"
    ),
    createButton(
      "playground_request_encounter",
      "Request Encounter",
      ButtonStyle.Secondary,
      "🎲"
    )
  );

  const actionButtons = createButtonRowWithButtons(
    createButton(
      "playground_request_postcard",
      "Request Postcard",
      ButtonStyle.Secondary,
      "🌍"
    ),
    createButton(
      "playground_request_recap",
      "Request Recap",
      ButtonStyle.Secondary,
      "📰"
    ),
    createButton(
      "playground_request_help",
      "Request Help",
      ButtonStyle.Secondary,
      "❓"
    )
  );

  return { embed, components: [buttons, actionButtons] };
};

/**
 * Generate a short AI description for the spotlight
 */
const generateSpotlightDescription = async (
  botName: string,
  story: { arc: { faction: string; role: string }; storyPowers?: string[] }
): Promise<string | null> => {
  const prompt = `Write a SHORT (2-3 sentence) dramatic introduction for a robot warrior named "${botName}".
Faction: ${story.arc.faction}
Role: ${story.arc.role}
Powers: ${story.storyPowers?.join(", ") ?? "Unknown"}

Be dramatic and mysterious. Make readers want to learn more. Use present tense.`;

  const result = await generateText({
    systemPrompt:
      "You are a narrator for GlyphBots, a collection of sentient robot warriors. Write short, punchy descriptions.",
    userPrompt: prompt,
    maxTokens: 150,
    temperature: 0.8,
  });

  return result ? result.trim() : null;
};
