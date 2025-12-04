/**
 * Lore Narrative Prompts
 *
 * Different narrative styles for variety in lore generation.
 * Styles rotate round-robin to keep content fresh.
 */

import type { LoreContext } from "../lib/types";

/** Narrative style definition */
export type NarrativeStyle = {
  name: string;
  systemPrompt: string;
  userSuffix: string;
};

/** Available narrative styles */
export const NARRATIVE_STYLES: NarrativeStyle[] = [
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
export const getNextStyle = (): NarrativeStyle => {
  const style = NARRATIVE_STYLES[styleIndex];
  styleIndex = (styleIndex + 1) % NARRATIVE_STYLES.length;
  return style;
};

/**
 * Build the user prompt from lore context and style
 */
export const buildUserPrompt = (
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
