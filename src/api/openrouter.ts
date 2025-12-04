import { prefixedLogger } from "../lib/logger";
import type { GeneratedLore, LoreContext } from "../lib/types";
import {
  DEFAULT_OPENROUTER_MODEL,
  getErrorMessage,
  truncate,
} from "../lib/utils";

const log = prefixedLogger("OpenRouter");

/** Maximum length for Discord embed description */
const MAX_NARRATIVE_LENGTH = 4000;

/** System prompt for lore generation */
const SYSTEM_PROMPT = `You are a master storyteller for GlyphBots, a collection of sentient robots with unique personalities, abilities, and missions. Your task is to craft compelling short narratives based on bot data and artifacts.

Your narratives should:
- Be atmospheric and evocative, drawing readers into the GlyphBots universe
- Reference the bot's specific traits, abilities, and mission context
- Connect the artifact to the bot's ongoing story arc
- Use vivid, cinematic language that paints a picture
- Be concise but impactful (2-3 paragraphs maximum)
- End with a hook or sense of continuation

Tone: Blend cyberpunk aesthetics with mythic storytelling. These are not just robots—they are heroes, villains, wanderers, and legends in a vast digital cosmos.`;

/**
 * Build the user prompt from lore context
 */
const buildUserPrompt = (context: LoreContext): string => {
  const { artifact, bot, story } = context;

  let prompt = `Create a short narrative for this GlyphBots moment:

**Bot:** ${bot.name} (#${bot.tokenId})
**Artifact:** ${artifact.title}`;

  // Add traits if available
  if (bot.traits.length > 0) {
    const traitList = bot.traits
      .slice(0, 5)
      .map((t) => `${t.trait_type}: ${t.value}`)
      .join(", ");
    prompt += `\n**Traits:** ${traitList}`;
  }

  // Add story context if available
  if (story) {
    prompt += `\n**Role:** ${story.arc.role}`;
    prompt += `\n**Faction:** ${story.arc.faction}`;
    prompt += `\n**Mission:** ${story.arc.mission.objective}`;
    prompt += `\n**Setting:** ${story.arc.mission.setting}`;

    if (story.storySnippet) {
      prompt += `\n**Background:** ${story.storySnippet}`;
    }

    if (story.arc.abilities.length > 0) {
      const abilities = story.arc.abilities
        .slice(0, 3)
        .map((a) => a.name)
        .join(", ");
      prompt += `\n**Abilities:** ${abilities}`;
    }
  }

  prompt += `

Write a compelling 2-3 paragraph narrative that captures this moment in ${bot.name}'s journey. The artifact represents a significant event or creation. Make it dramatic and memorable.`;

  return prompt;
};

/** Chat response type */
type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: string; text?: string }>;
    };
  }>;
};

/**
 * Create OpenRouter client and send chat request using dynamic import (ESM package)
 */
const sendChatRequest = async (params: {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens: number;
  temperature: number;
}): Promise<ChatResponse> => {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }

  const { OpenRouter } = await import("@openrouter/sdk");

  const client = new OpenRouter({
    apiKey,
  });

  const response = await client.chat.send({
    model: params.model,
    messages: params.messages,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
  });

  return response as ChatResponse;
};

/**
 * Generate a lore narrative using OpenRouter
 */
export const generateLoreNarrative = async (
  context: LoreContext
): Promise<GeneratedLore | null> => {
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  log.info(`Generating lore for ${context.bot.name} using model ${model}`);

  try {
    const userPrompt = buildUserPrompt(context);

    log.debug("Sending request to OpenRouter");

    const response = await sendChatRequest({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 1000,
      temperature: 0.8,
    });

    const rawContent = response.choices?.at(0)?.message?.content;

    if (!rawContent) {
      log.error("No content returned from OpenRouter");
      return null;
    }

    // Handle content that can be string or array of content items
    let content: string;
    if (typeof rawContent === "string") {
      content = rawContent;
    } else if (Array.isArray(rawContent)) {
      // Extract text from content items with type: "text"
      const textParts: string[] = [];
      for (const item of rawContent) {
        if (item.type === "text" && "text" in item && item.text) {
          textParts.push(item.text);
        }
      }
      content = textParts.join("");
    } else {
      log.error("Unexpected content type from OpenRouter");
      return null;
    }

    if (!content) {
      log.error("No text content extracted from OpenRouter response");
      return null;
    }

    log.debug(`Generated narrative (${content.length} chars)`);

    // Create a title from bot and artifact
    const title = `${context.bot.name}: ${context.artifact.title}`;

    return {
      title,
      narrative: truncate(content.trim(), MAX_NARRATIVE_LENGTH),
      artifact: context.artifact,
      bot: context.bot,
    };
  } catch (error) {
    log.error(`Error generating lore: ${getErrorMessage(error)}`);
    return null;
  }
};
