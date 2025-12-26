/**
 * Random Encounter Content
 *
 * "What if?" scenarios featuring random bots.
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

const log = prefixedLogger("Encounter");

/** Encounter brand color */
const ENCOUNTER_COLOR: HexColorString = "#9966ff";

/** Encounter scenario templates */
const SCENARIOS = [
  "discovers an ancient artifact buried in the wastes",
  "encounters a mysterious traveler at a crossroads",
  "receives a distress signal from an unknown source",
  "stumbles upon a hidden sanctuary",
  "is challenged by a rival from their past",
  "finds themselves transported to an unfamiliar realm",
  "witnesses a rare cosmic phenomenon",
  "uncovers a conspiracy within their faction",
  "must make a choice that will change everything",
  "faces their greatest fear",
];

/**
 * Generate a random encounter embed with buttons
 */
export const generateEncounter = async (): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} | null> => {
  // Pick two random bots
  const tokenId1 = Math.floor(Math.random() * 11_111) + 1;
  const tokenId2 = Math.floor(Math.random() * 11_111) + 1;

  log.info(`Generating encounter for bots #${tokenId1} and #${tokenId2}`);

  const [bot1, bot2] = await Promise.all([
    fetchBot(tokenId1),
    fetchBot(tokenId2),
  ]);

  if (!(bot1 && bot2)) {
    log.warn("Failed to fetch bots for encounter");
    return null;
  }

  const [story1, story2] = await Promise.all([
    fetchBotStory(tokenId1),
    fetchBotStory(tokenId2),
  ]);

  // Pick a random scenario
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];

  // Generate the encounter narrative
  const narrative = await generateEncounterNarrative({
    bot1Name: bot1.name,
    bot2Name: bot2.name,
    faction1: story1?.arc?.faction ?? "Unknown",
    faction2: story2?.arc?.faction ?? "Unknown",
    scenario,
  });

  const embed = new EmbedBuilder()
    .setColor(ENCOUNTER_COLOR)
    .setTitle("🎲 RANDOM ENCOUNTER")
    .setDescription(
      `*What if ${bot1.name} ${scenario}... and met ${bot2.name}?*`
    );

  embed.addFields(
    {
      name: `🤖 ${bot1.name}`,
      value: `[#${tokenId1}](${getBotUrl(tokenId1)})\n${story1?.arc?.faction ?? "Unknown Faction"}`,
      inline: true,
    },
    {
      name: `🤖 ${bot2.name}`,
      value: `[#${tokenId2}](${getBotUrl(tokenId2)})\n${story2?.arc?.faction ?? "Unknown Faction"}`,
      inline: true,
    }
  );

  if (narrative) {
    embed.addFields({
      name: "📜 The Encounter",
      value: narrative,
    });
  }

  embed.setFooter({
    text: "🎲 Use /random bot to discover more GlyphBots!",
  });

  // Build buttons
  const buttons = createButtonRowWithButtons(
    createBotLinkButton(tokenId1, `View ${bot1.name}`),
    createBotLinkButton(tokenId2, `View ${bot2.name}`)
  );

  const actionButtons = createButtonRowWithButtons(
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
      "playground_request_postcard",
      "Request Postcard",
      ButtonStyle.Secondary,
      "🌍"
    )
  );

  const actionButtons2 = createButtonRowWithButtons(
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

  return { embed, components: [buttons, actionButtons, actionButtons2] };
};

type EncounterNarrativeOpts = {
  bot1Name: string;
  bot2Name: string;
  faction1: string;
  faction2: string;
  scenario: string;
};

/**
 * Generate encounter narrative
 */
const generateEncounterNarrative = async (
  opts: EncounterNarrativeOpts
): Promise<string | null> => {
  const { bot1Name, bot2Name, faction1, faction2, scenario } = opts;
  const prompt = `Write a SHORT (4-5 sentences) dramatic encounter between two robots:

BOT 1: ${bot1Name} (${faction1})
BOT 2: ${bot2Name} (${faction2})
SCENARIO: ${bot1Name} ${scenario}... and encounters ${bot2Name}.

Write the moment they meet. Are they allies? Enemies? What happens?
Style: Dramatic, tension-filled, leaves reader wanting more.
End on a cliffhanger or dramatic moment.`;

  const result = await generateText({
    systemPrompt:
      "You write dramatic sci-fi encounter scenes between robot warriors. Short, punchy, cinematic.",
    userPrompt: prompt,
    maxTokens: 250,
    temperature: 0.9,
  });

  return result ? result.trim() : null;
};
