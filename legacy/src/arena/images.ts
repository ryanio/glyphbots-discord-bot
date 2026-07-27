/**
 * Arena Image Generation
 *
 * Generates victory and critical hit images for high-impact moments.
 */

import { fetchBotArtifacts, getBotPngUrl } from "../api/glyphbots";
import { generateImage, imageToBuffer } from "../api/google-ai";
import { prefixedLogger } from "../lib/logger";
import type { BattleState, FighterState } from "./state";

const log = prefixedLogger("ArenaImages");

/** Victory image generation chance (50%) */
const VICTORY_IMAGE_CHANCE = 0.5;

/** Critical hit image generation chance (15%) */
const CRIT_IMAGE_CHANCE = 0.15;

/**
 * Determine if a victory image should be generated
 */
export const shouldGenerateVictoryImage = (
  _battle: BattleState,
  isEpic: boolean
): boolean => {
  // Always generate for epic victories
  if (isEpic) {
    return true;
  }

  // 50% chance for regular victories
  return Math.random() < VICTORY_IMAGE_CHANCE;
};

/**
 * Determine if a critical hit image should be generated
 */
export const shouldGenerateCritImage = (): boolean =>
  Math.random() < CRIT_IMAGE_CHANCE;

/**
 * Build victory image prompt
 */
const buildVictoryPrompt = (
  _battle: BattleState,
  winner: FighterState,
  loser: FighterState,
  isEpic: boolean
): string => {
  const winnerTraits =
    winner.bot.traits
      .slice(0, 4)
      .map((t) => t.value)
      .join(", ") || "robotic, mechanical";

  const loserTraits =
    loser.bot.traits
      .slice(0, 4)
      .map((t) => t.value)
      .join(", ") || "robotic, mechanical";

  const epicModifier = isEpic
    ? "EPIC, legendary, climactic, dramatic lighting, particle effects, "
    : "";

  return `${epicModifier}Victory scene in a futuristic arena: A triumphant robot warrior (${winnerTraits}) stands victorious over a defeated opponent (${loserTraits}). The winner has a heroic pose, energy crackling around them. The crowd in the background is cheering. Dramatic lighting, cyberpunk arena setting, glowing neon accents. High quality digital art, dynamic composition.`;
};

/**
 * Build critical hit image prompt
 */
const buildCritPrompt = (
  attacker: FighterState,
  _defender: FighterState,
  abilityName: string
): string => {
  const attackerTraits =
    attacker.bot.traits
      .slice(0, 4)
      .map((t) => t.value)
      .join(", ") || "robotic, mechanical";

  return `Dramatic critical hit moment: A robot warrior (${attackerTraits}) unleashes a devastating attack called "${abilityName}". Energy explosion, impact effects, motion blur. Time frozen at the moment of impact. Cyberpunk arena background, dramatic lighting, particle effects. High quality digital art, dynamic action pose.`;
};

/**
 * Get the most relevant artifact image URL for a bot
 * Returns the most recent artifact with an image URL
 */
const getBotArtifactImageUrl = async (
  tokenId: number
): Promise<string | null> => {
  try {
    const artifacts = await fetchBotArtifacts(tokenId);
    if (artifacts.length === 0) {
      return null;
    }

    // Return the most recent artifact with an image URL
    // Artifacts are typically returned in reverse chronological order
    const artifactWithImage = artifacts.find((a) => a.imageUrl);
    return artifactWithImage?.imageUrl ?? null;
  } catch (error) {
    log.warn(`Failed to fetch artifacts for bot ${tokenId}: ${error}`);
    return null;
  }
};

/**
 * Generate a victory image
 */
export const generateVictoryImage = async (
  battle: BattleState,
  winner: FighterState,
  loser: FighterState,
  isEpic: boolean
): Promise<Buffer | null> => {
  log.info(
    `Generating ${isEpic ? "epic " : ""}victory image for battle ${battle.id}`
  );

  try {
    const prompt = buildVictoryPrompt(battle, winner, loser, isEpic);
    const imageUrls = [
      getBotPngUrl(winner.bot.tokenId),
      getBotPngUrl(loser.bot.tokenId),
    ];

    // Add artifact images if available (winner's artifact is most relevant)
    const winnerArtifactUrl = await getBotArtifactImageUrl(winner.bot.tokenId);
    if (winnerArtifactUrl) {
      imageUrls.push(winnerArtifactUrl);
      log.debug("Including winner artifact image in victory scene");
    }

    const result = await generateImage({
      prompt,
      imageUrls,
      aspectRatio: "16:9",
    });

    if (!result) {
      log.warn("Failed to generate victory image");
      return null;
    }

    const buffer = imageToBuffer(result);
    battle.generatedImages.push("victory");

    log.info(`Victory image generated successfully (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    log.error("Error generating victory image:", error);
    return null;
  }
};

/**
 * Generate a critical hit image
 */
export const generateCriticalHitImage = async (
  attacker: FighterState,
  defender: FighterState,
  abilityName: string
): Promise<Buffer | null> => {
  log.info(`Generating critical hit image for ${attacker.bot.name}`);

  try {
    const prompt = buildCritPrompt(attacker, defender, abilityName);
    const imageUrls = [
      getBotPngUrl(attacker.bot.tokenId),
      getBotPngUrl(defender.bot.tokenId),
    ];

    // Add attacker's artifact image if available (most relevant for attack scenes)
    const attackerArtifactUrl = await getBotArtifactImageUrl(
      attacker.bot.tokenId
    );
    if (attackerArtifactUrl) {
      imageUrls.push(attackerArtifactUrl);
      log.debug("Including attacker artifact image in critical hit scene");
    }

    const result = await generateImage({
      prompt,
      imageUrls,
      aspectRatio: "16:9",
    });

    if (!result) {
      log.warn("Failed to generate critical hit image");
      return null;
    }

    const buffer = imageToBuffer(result);
    log.info(
      `Critical hit image generated successfully (${buffer.length} bytes)`
    );
    return buffer;
  } catch (error) {
    log.error("Error generating critical hit image:", error);
    return null;
  }
};

/**
 * Generate an arena event image
 */
export const generateArenaEventImage = async (
  eventType: "power_surge" | "chaos_field" | "arena_hazard"
): Promise<Buffer | null> => {
  log.info(`Generating arena event image: ${eventType}`);

  const prompts: Record<string, string> = {
    power_surge:
      "Futuristic arena power surge: Lightning and energy bolts crackling through a cyberpunk battle arena. Glowing power conduits overloading. Dramatic electrical effects, blue and white energy. High quality digital art.",
    chaos_field:
      "Reality warping chaos field in futuristic arena: Dimensional rifts opening, swirling purple and black energy. Space-time distortion effects. Surreal and otherworldly. Cyberpunk setting. High quality digital art.",
    arena_hazard:
      "Arena hazard activation: Energy spikes and turrets emerging from the floor of a cyberpunk arena. Warning lights flashing red and orange. Dangerous environment. Dramatic lighting. High quality digital art.",
  };

  try {
    const result = await generateImage({
      prompt: prompts[eventType],
      aspectRatio: "16:9",
    });

    if (!result) {
      log.warn("Failed to generate arena event image");
      return null;
    }

    const buffer = imageToBuffer(result);
    log.info(
      `Arena event image generated successfully (${buffer.length} bytes)`
    );
    return buffer;
  } catch (error) {
    log.error("Error generating arena event image:", error);
    return null;
  }
};
