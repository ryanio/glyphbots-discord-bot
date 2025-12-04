/**
 * Lore Generation
 *
 * Generates narrative lore for GlyphBots artifacts using AI.
 */

import { type ContentPart, generateText } from "../api/openrouter";
import { prefixedLogger } from "../lib/logger";
import type { GeneratedLore, LoreContext } from "../lib/types";
import { DEFAULT_OPENROUTER_MODEL, truncate } from "../lib/utils";
import { buildUserPrompt, getNextStyle } from "./prompts";

const log = prefixedLogger("LoreGen");

/** Maximum length for narrative text */
const MAX_NARRATIVE_LENGTH = 4000;

/**
 * Build user message content, including artifact image if available
 */
const buildMessageContent = (
  context: LoreContext,
  textPrompt: string
): string | ContentPart[] => {
  if (context.artifact.imageUrl) {
    return [
      { type: "text", text: textPrompt },
      { type: "image_url", image_url: { url: context.artifact.imageUrl } },
    ];
  }
  return textPrompt;
};

/**
 * Generate a lore narrative for the given context
 */
export const generateLoreNarrative = async (
  context: LoreContext
): Promise<GeneratedLore | null> => {
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  const style = getNextStyle();

  log.info(
    `Generating lore for ${context.bot.name} using ${model} (style: ${style.name})`
  );

  const userPrompt = buildUserPrompt(context, style);
  const userContent = buildMessageContent(context, userPrompt);
  const hasImage = Array.isArray(userContent);

  if (hasImage) {
    log.debug("Including artifact image in request");
  }

  const narrative = await generateText({
    model,
    messages: [
      { role: "system", content: style.systemPrompt },
      { role: "user", content: userContent },
    ],
    maxTokens: 2000,
    temperature: 0.8,
  });

  if (!narrative) {
    log.error("Failed to generate narrative");
    return null;
  }

  log.debug(`Generated narrative (${narrative.length} chars)`);

  return {
    title: `${context.bot.name}: ${context.artifact.title}`,
    narrative: truncate(narrative, MAX_NARRATIVE_LENGTH),
    artifact: context.artifact,
    bot: context.bot,
  };
};
