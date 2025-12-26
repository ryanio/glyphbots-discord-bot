/**
 * Item Discovery Content
 *
 * Features newly minted artifacts with AI-generated lore.
 */

import {
  type ActionRowBuilder,
  type ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import {
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../api/glyphbots";
import { generateText } from "../api/google-ai";
import {
  createArtifactLinkButton,
  createBotLinkButton,
  createButton,
  createButtonRowWithButtons,
} from "../lib/discord/buttons";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("Discovery");

/** Discovery brand color */
const DISCOVERY_COLOR: HexColorString = "#00ff88";

/**
 * Generate an item discovery embed with buttons
 */
export const generateDiscovery = async (): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} | null> => {
  log.info("Generating item discovery");

  // Get recent artifacts and filter for "item" type
  const artifacts = await fetchRecentArtifacts(50);
  const itemArtifacts = artifacts.filter(
    (a) => a.type?.toLowerCase() === "item"
  );

  // Use item artifacts if available, otherwise use all artifacts
  const pool = itemArtifacts.length > 0 ? itemArtifacts : artifacts;
  if (pool.length === 0) {
    log.warn("No artifacts available for discovery");
    return null;
  }

  // Pick from top 5 most recent
  const recentSlice = pool.slice(0, 5);
  const artifact = recentSlice[Math.floor(Math.random() * recentSlice.length)];

  // Generate item lore
  const lore = await generateItemLore(artifact.title);

  const embed = new EmbedBuilder()
    .setColor(DISCOVERY_COLOR)
    .setTitle("🎒 ITEM DISCOVERY")
    .setDescription("*A new artifact has emerged from the forges...*");

  embed.addFields({
    name: "📦 Artifact",
    value: `**${artifact.title}**`,
  });

  if (lore) {
    embed.addFields({
      name: "📜 Lore",
      value: lore,
    });
  }

  embed.addFields(
    {
      name: "🔗 View Artifact",
      value: artifact.contractTokenId
        ? `[View on GlyphBots](${getArtifactUrl(artifact.contractTokenId)})`
        : "Not yet minted",
      inline: true,
    },
    {
      name: "🤖 Creator",
      value: `[Bot #${artifact.botTokenId}](${getBotUrl(artifact.botTokenId)})`,
      inline: true,
    }
  );

  if (artifact.mintedAt) {
    const mintDate = new Date(artifact.mintedAt);
    embed.addFields({
      name: "⏰ Minted",
      value: mintDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      inline: true,
    });
  }

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  embed.setFooter({
    text: "🎒 Use /random artifact to discover more items!",
  });

  // Build buttons
  const buttonComponents: ButtonBuilder[] = [];
  if (artifact.contractTokenId) {
    buttonComponents.push(
      createArtifactLinkButton(artifact.contractTokenId, "View Artifact")
    );
  }
  buttonComponents.push(
    createBotLinkButton(artifact.botTokenId, "View Creator Bot")
  );

  const actionButtons = [
    createButton(
      "playground_request_spotlight",
      "Request Spotlight",
      ButtonStyle.Secondary,
      "🌟"
    ),
    createButton(
      "playground_request_encounter",
      "Request Encounter",
      ButtonStyle.Secondary,
      "🎲"
    ),
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
    ),
  ];

  return {
    embed,
    components: [
      createButtonRowWithButtons(...buttonComponents),
      createButtonRowWithButtons(...actionButtons.slice(0, 3)),
      createButtonRowWithButtons(...actionButtons.slice(3)),
    ],
  };
};

/**
 * Generate item lore
 */
const generateItemLore = async (itemName: string): Promise<string | null> => {
  const prompt = `Write a SHORT (2-3 sentences) mysterious lore description for an artifact called "${itemName}".

Think: ancient item with hidden powers. What is its origin? What can it do? Who covets it?
Style: Mysterious, intriguing, hints at greater power.`;

  const result = await generateText({
    systemPrompt:
      "You write mysterious artifact descriptions for a sci-fi/fantasy robot world. Short and evocative.",
    userPrompt: prompt,
    maxTokens: 150,
    temperature: 0.85,
  });

  return result ? result.trim() : null;
};
