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
const SYSTEM_PROMPT = `You are a storyteller for GlyphBots—sentient robots in a vast digital cosmos.

Write SHORT, captivating micro-fiction. Rules:

1. MAX 100 words total. Brevity is key.
2. Use line breaks between sentences for readability.
3. Show, don't tell. Action and emotion over explanation.
4. End with intrigue—leave the reader wanting more.
5. Reference the artifact image you see.

Style: Punchy. Cinematic. Mysterious. Like a movie trailer, not a novel.

BAD: Dense paragraphs explaining everything.
GOOD: Short lines. Tension. A moment captured. Then silence.`;

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

Write a punchy micro-story (under 100 words) about this moment. Use line breaks between sentences. Make every word count.`;

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

/** Message content part for multimodal messages */
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: { url: string } };

/** Message type for chat requests */
type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | ContentPart[] };

/**
 * Create OpenRouter client and send chat request using dynamic import (ESM package)
 */
const sendChatRequest = async (params: {
  model: string;
  messages: ChatMessage[];
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
 * Build user message content, optionally including the artifact image
 */
const buildUserContent = (context: LoreContext): string | ContentPart[] => {
  const textPrompt = buildUserPrompt(context);

  // If artifact has an image URL, include it as multimodal content
  if (context.artifact.imageUrl) {
    return [
      { type: "text", text: textPrompt },
      {
        type: "image_url",
        imageUrl: { url: context.artifact.imageUrl },
      },
    ];
  }

  // No image, return text only
  return textPrompt;
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
    const userContent = buildUserContent(context);
    const hasImage =
      Array.isArray(userContent) &&
      userContent.some((p) => p.type === "image_url");

    log.debug(
      `Sending request to OpenRouter${hasImage ? " (with artifact image)" : ""}`
    );

    const response = await sendChatRequest({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      maxTokens: 2000,
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
