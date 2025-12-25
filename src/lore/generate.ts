/**
 * Lore Generation
 *
 * Generates narrative lore for GlyphBots artifacts using Google AI.
 */

import { generateText } from "../api/google-ai";
import { prefixedLogger } from "../lib/logger";
import type { GeneratedLore, LoreContext } from "../lib/types";
import { truncate } from "../lib/utils";
import { buildUserPrompt, getNextStyle } from "./prompts";

const log = prefixedLogger("LoreGen");

/** Maximum length for narrative text */
const MAX_NARRATIVE_LENGTH = 4000;

/**
 * Generate a lore narrative for the given context
 */
export const generateLoreNarrative = async (
  context: LoreContext
): Promise<GeneratedLore | null> => {
  try {
    const style = getNextStyle();

    log.info(`Generating lore for ${context.bot.name} (style: ${style.name})`);

    const userPrompt = buildUserPrompt(context, style);

    if (context.artifact.imageUrl) {
      log.debug("Including artifact image in request");
    }

    const narrative = await generateText({
      systemPrompt: style.systemPrompt,
      userPrompt,
      imageUrl: context.artifact.imageUrl,
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
  } catch (error) {
    log.error("Failed to generate narrative", error);
    return null;
  }
};
