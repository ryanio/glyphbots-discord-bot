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

/** Narrative style definitions */
type NarrativeStyle = {
  name: string;
  systemPrompt: string;
  userSuffix: string;
};

/** Available narrative styles - rotated for variety */
const NARRATIVE_STYLES: NarrativeStyle[] = [
  {
    name: "cinematic",
    systemPrompt: `You are a storyteller for GlyphBots—sentient robots in a vast digital cosmos.

Write SHORT, captivating micro-fiction. Rules:
1. MAX 100 words. Brevity is key.
2. Line breaks between sentences.
3. Show, don't tell.
4. End with intrigue.
5. Reference the artifact image.

Style: Punchy. Cinematic. Like a movie trailer.`,
    userSuffix:
      "Write a punchy micro-story (under 100 words). Use line breaks between sentences.",
  },
  {
    name: "transmission",
    systemPrompt: `You are an intercepted signal from the GlyphBots universe—fragmented transmissions from sentient robots.

Write as a CORRUPTED TRANSMISSION. Rules:
1. MAX 80 words.
2. Use [...] for signal breaks.
3. Mix technical jargon with emotion.
4. Feel incomplete, urgent.
5. Reference the artifact image.

Format: Like intercepted radio chatter. Broken. Urgent. Real.`,
    userSuffix:
      "Write as a fragmented transmission (under 80 words). Use [...] for breaks. Make it feel intercepted.",
  },
  {
    name: "firstPerson",
    systemPrompt: `You ARE the GlyphBot. Write from inside their mind.

Rules:
1. MAX 100 words.
2. First person ("I").
3. Raw, immediate thoughts.
4. Short sentences. Fragments okay.
5. Reference what you see in the artifact image.

Style: Stream of consciousness. Present tense. Intimate.`,
    userSuffix:
      "Write as the bot in first person (under 100 words). Present tense. Raw thoughts.",
  },
  {
    name: "poetic",
    systemPrompt: `You craft verse for GlyphBots—sentient machines in a digital cosmos.

Write MINIMAL poetry. Rules:
1. MAX 60 words.
2. 4-6 lines only.
3. No rhyming required.
4. Evocative imagery.
5. Reference the artifact image.

Style: Haiku-adjacent. Each word deliberate. White space matters.`,
    userSuffix:
      "Write a short poem (under 60 words, 4-6 lines). Minimal. Evocative.",
  },
  {
    name: "logEntry",
    systemPrompt: `You write mission logs for GlyphBots—terse field reports from sentient robots.

Write a BRIEF LOG ENTRY. Rules:
1. MAX 80 words.
2. Start with timestamp format [CYCLE-XXX].
3. Clinical but with cracks of personality.
4. End with status or cryptic note.
5. Reference the artifact image.

Style: Military brevity meets existential robot thoughts.`,
    userSuffix:
      "Write a mission log entry (under 80 words). Start with [CYCLE-XXX]. Brief but revealing.",
  },
];

/** Track which style to use next (round-robin) */
let styleIndex = Math.floor(Math.random() * NARRATIVE_STYLES.length);

/**
 * Get the next narrative style (round-robin rotation)
 */
const getNextStyle = (): NarrativeStyle => {
  const style = NARRATIVE_STYLES[styleIndex];
  styleIndex = (styleIndex + 1) % NARRATIVE_STYLES.length;
  return style;
};

/**
 * Build the user prompt from lore context and style
 */
const buildUserPrompt = (
  context: LoreContext,
  style: NarrativeStyle
): string => {
  const { artifact, bot, story } = context;

  let prompt = `Create a narrative for this GlyphBots moment:

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

  prompt += `\n\n${style.userSuffix}`;

  return prompt;
};

/** OpenRouter API endpoint */
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

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
  | { type: "image_url"; url: string };

/** Message type for chat requests */
type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | ContentPart[] };

/**
 * Send chat request to OpenRouter API using fetch
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

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
  }

  return (await response.json()) as ChatResponse;
};

/**
 * Build user message content, optionally including the artifact image
 */
const buildUserContent = (
  context: LoreContext,
  style: NarrativeStyle
): string | ContentPart[] => {
  const textPrompt = buildUserPrompt(context, style);

  // If artifact has an image URL, include it as multimodal content
  if (context.artifact.imageUrl) {
    return [
      { type: "text", text: textPrompt },
      { type: "image_url", url: context.artifact.imageUrl },
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
  const style = getNextStyle();

  log.info(
    `Generating lore for ${context.bot.name} using model ${model} (style: ${style.name})`
  );

  try {
    const userContent = buildUserContent(context, style);
    const hasImage =
      Array.isArray(userContent) &&
      userContent.some((p) => p.type === "image_url");

    log.debug(
      `Sending request to OpenRouter${hasImage ? " (with artifact image)" : ""}`
    );

    const response = await sendChatRequest({
      model,
      messages: [
        { role: "system", content: style.systemPrompt },
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
