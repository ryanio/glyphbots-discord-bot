/**
 * World Postcard Content
 *
 * Generates atmospheric descriptions of world artifacts.
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

const log = prefixedLogger("Postcard");

/** Postcard brand color */
const POSTCARD_COLOR: HexColorString = "#66ccff";

/**
 * Generate a world postcard embed with buttons
 */
export const generatePostcard = async (): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} | null> => {
  log.info("Generating world postcard");

  // Get recent artifacts and filter for "world" type
  const artifacts = await fetchRecentArtifacts(100);
  const worldArtifacts = artifacts.filter(
    (a) =>
      a.title.toLowerCase().includes("world") ||
      a.title.toLowerCase().includes("realm") ||
      a.title.toLowerCase().includes("domain") ||
      a.title.toLowerCase().includes("land")
  );

  // If no world artifacts, pick a random artifact
  const artifact =
    worldArtifacts.length > 0
      ? worldArtifacts[Math.floor(Math.random() * worldArtifacts.length)]
      : artifacts[Math.floor(Math.random() * artifacts.length)];

  if (!artifact) {
    log.warn("No artifacts available for postcard");
    return null;
  }

  // Generate atmospheric description
  const description = await generateWorldDescription(artifact.title);

  const embed = new EmbedBuilder()
    .setColor(POSTCARD_COLOR)
    .setTitle("🌍 WORLD POSTCARD")
    .setDescription(`*A transmission from ${artifact.title}*`);

  if (description) {
    embed.addFields({
      name: "📜 Dispatch",
      value: description,
    });
  }

  embed.addFields(
    {
      name: "📍 Origin",
      value: `[${artifact.title}](${artifact.contractTokenId ? getArtifactUrl(artifact.contractTokenId) : "#"})`,
      inline: true,
    },
    {
      name: "🤖 Creator Bot",
      value: `[#${artifact.botTokenId}](${getBotUrl(artifact.botTokenId)})`,
      inline: true,
    }
  );

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  embed.setFooter({
    text: "🌍 Explore more worlds with /random world",
  });

  // Build buttons
  const buttonComponents: ButtonBuilder[] = [];
  if (artifact.contractTokenId) {
    buttonComponents.push(
      createArtifactLinkButton(artifact.contractTokenId, "View World")
    );
  }
  buttonComponents.push(
    createBotLinkButton(artifact.botTokenId, "View Creator")
  );

  const actionButtons = [
    createButton(
      "playground_request_spotlight",
      "Request Spotlight",
      ButtonStyle.Secondary,
      "🌟"
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
 * Generate an atmospheric world description
 */
const generateWorldDescription = async (
  worldName: string
): Promise<string | null> => {
  const prompt = `Write a SHORT (3-4 sentences) atmospheric postcard-style description from a traveler visiting "${worldName}".

Style: First-person, like a postcard home. Wonder and discovery. Sensory details.
Tone: Mysterious, evocative, slightly melancholic.
Format: Start with "Greetings from" or similar travel postcard opening.`;

  const result = await generateText({
    systemPrompt:
      "You write atmospheric travel postcards from fantastical sci-fi worlds. Short, evocative, memorable.",
    userPrompt: prompt,
    maxTokens: 200,
    temperature: 0.9,
  });

  return result ? result.trim() : null;
};
