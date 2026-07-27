/**
 * Arena Battle Narrative Generation
 *
 * Uses Google AI to generate dramatic battle narratives.
 */

import { generateText } from "../api/google-ai";
import { prefixedLogger } from "../lib/logger";
import type { CombatResolution } from "./combat";
import {
  BATTLE_PROMPTS,
  buildNarrativePrompt,
  buildVictoryPrompt,
} from "./prompts";
import type { BattleState, FighterState } from "./state";

const log = prefixedLogger("ArenaNarrative");

/** Maximum narrative length */
const MAX_NARRATIVE_LENGTH = 500;

/** Maximum victory narrative length */
const MAX_VICTORY_NARRATIVE_LENGTH = 800;

/**
 * Generate a round narrative
 */
export const generateRoundNarrative = async (
  battle: BattleState,
  resolution: CombatResolution
): Promise<string> => {
  if (!battle.blueFighter) {
    return resolution.events.join("\n");
  }

  const prompt = buildNarrativePrompt(battle, resolution);

  try {
    const narrative = await generateText({
      systemPrompt: BATTLE_PROMPTS.roundNarration,
      userPrompt: prompt,
      maxTokens: 300,
      temperature: 0.9,
    });

    if (!narrative) {
      log.warn("Failed to generate narrative, using fallback");
      return generateFallbackNarrative(battle, resolution);
    }

    return truncateNarrative(narrative, MAX_NARRATIVE_LENGTH);
  } catch (error) {
    log.error("Error generating narrative:", error);
    return generateFallbackNarrative(battle, resolution);
  }
};

/**
 * Generate a victory narrative
 */
export const generateVictoryNarrative = async (
  battle: BattleState,
  winner: FighterState,
  loser: FighterState,
  isEpic: boolean
): Promise<string> => {
  const prompt = buildVictoryPrompt(battle, winner, loser, isEpic);

  try {
    const narrative = await generateText({
      systemPrompt: isEpic
        ? BATTLE_PROMPTS.epicVictory
        : BATTLE_PROMPTS.victory,
      userPrompt: prompt,
      maxTokens: 400,
      temperature: 0.9,
    });

    if (!narrative) {
      log.warn("Failed to generate victory narrative, using fallback");
      return generateFallbackVictoryNarrative(winner, loser);
    }

    return truncateNarrative(narrative, MAX_VICTORY_NARRATIVE_LENGTH);
  } catch (error) {
    log.error("Error generating victory narrative:", error);
    return generateFallbackVictoryNarrative(winner, loser);
  }
};

/**
 * Generate a critical hit narrative
 */
export const generateCriticalHitNarrative = async (
  attacker: FighterState,
  defender: FighterState,
  abilityName: string,
  damage: number
): Promise<string> => {
  const prompt = `
ATTACKER: ${attacker.bot.name} (${attacker.story?.arc?.faction ?? "Unknown"})
DEFENDER: ${defender.bot.name} (${defender.story?.arc?.faction ?? "Unknown"})
ABILITY: ${abilityName}
DAMAGE: ${damage}

Write a dramatic 2-3 sentence description of this devastating critical strike!
`;

  try {
    const narrative = await generateText({
      systemPrompt: BATTLE_PROMPTS.criticalHit,
      userPrompt: prompt,
      maxTokens: 150,
      temperature: 0.95,
    });

    if (!narrative) {
      return `**CRITICAL HIT!** ${attacker.bot.name}'s ${abilityName} deals ${damage} devastating damage to ${defender.bot.name}!`;
    }

    return narrative.trim();
  } catch {
    return `**CRITICAL HIT!** ${attacker.bot.name}'s ${abilityName} deals ${damage} devastating damage to ${defender.bot.name}!`;
  }
};

type FallbackAttackOpts = {
  name: string;
  damage: number;
  isCritical: boolean;
  verb: string;
  critPhrase: string;
};

/** Format a single attack line for fallback narrative */
const formatFallbackAttack = (opts: FallbackAttackOpts): string =>
  `${opts.name} ${opts.verb} ${opts.damage} damage${opts.isCritical ? opts.critPhrase : "."}`;

/**
 * Generate fallback narrative when AI fails
 */
const generateFallbackNarrative = (
  battle: BattleState,
  resolution: CombatResolution
): string => {
  const { redFighter, blueFighter } = battle;
  if (!blueFighter) {
    return "The battle continues...";
  }

  const lines: string[] = [];
  const isRedFirst = resolution.redFirst;
  const firstVerb = isRedFirst
    ? "strikes first, dealing"
    : "acts first, landing";
  const firstCrit = isRedFirst
    ? " with a critical hit!"
    : " with a critical strike!";
  const counterVerb = isRedFirst ? "counters for" : "responds with";
  const counterCrit = isRedFirst
    ? " — a critical blow!"
    : " — a devastating hit!";

  if (isRedFirst) {
    lines.push(
      formatFallbackAttack({
        name: redFighter.bot.name,
        damage: resolution.redDamageDealt,
        isCritical: resolution.redCritical,
        verb: firstVerb,
        critPhrase: firstCrit,
      })
    );
    if (blueFighter.hp > 0) {
      lines.push(
        formatFallbackAttack({
          name: blueFighter.bot.name,
          damage: resolution.blueDamageDealt,
          isCritical: resolution.blueCritical,
          verb: counterVerb,
          critPhrase: counterCrit,
        })
      );
    }
  } else {
    lines.push(
      formatFallbackAttack({
        name: blueFighter.bot.name,
        damage: resolution.blueDamageDealt,
        isCritical: resolution.blueCritical,
        verb: firstVerb,
        critPhrase: firstCrit,
      })
    );
    if (redFighter.hp > 0) {
      lines.push(
        formatFallbackAttack({
          name: redFighter.bot.name,
          damage: resolution.redDamageDealt,
          isCritical: resolution.redCritical,
          verb: counterVerb,
          critPhrase: counterCrit,
        })
      );
    }
  }

  return lines.join("\n");
};

/**
 * Generate fallback victory narrative
 */
const generateFallbackVictoryNarrative = (
  winner: FighterState,
  loser: FighterState
): string =>
  `In the end, **${winner.bot.name}** stood victorious over the fallen ${loser.bot.name}. The arena falls silent as the crowd processes what they've witnessed...`;

/**
 * Truncate narrative to max length, preserving sentence boundaries
 */
const truncateNarrative = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text.trim();
  }

  // Find the last sentence boundary before max length
  const truncated = text.slice(0, maxLength);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastExclaim = truncated.lastIndexOf("!");
  const lastQuestion = truncated.lastIndexOf("?");

  const lastBoundary = Math.max(lastPeriod, lastExclaim, lastQuestion);

  if (lastBoundary > maxLength * 0.5) {
    return text.slice(0, lastBoundary + 1).trim();
  }

  return `${truncated.trim()}...`;
};
