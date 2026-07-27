/**
 * Arena Battle Prompts
 *
 * System prompts and prompt builders for battle narration.
 */

import type { CombatResolution } from "./combat";
import type { BattleState, FighterState } from "./state";

/**
 * System prompts for different battle narrative types
 */
export const BATTLE_PROMPTS = {
  roundNarration: `You are a dramatic battle narrator for GlyphBots Arena—where sentient robots clash in epic combat.

Write SHORT, punchy battle narration. Rules:
1. MAX 4 sentences.
2. Describe the action cinematically.
3. Reference the abilities and damage dealt.
4. Build tension and drama.
5. Use present tense for immediacy.

Style: Anime fight commentary meets esports casting. Energetic, dramatic, visceral.

Formatting: Use **bold** for ability names and critical moments. Short sentences for impact.`,

  victory: `You are announcing the victory of a GlyphBots Arena battle.

Write a brief, triumphant victory narration. Rules:
1. MAX 3 sentences.
2. Celebrate the winner's triumph.
3. Acknowledge the defeated fighter's effort.
4. End with a memorable line.

Style: Sports championship moment. Emotional, climactic.`,

  epicVictory: `You are announcing an EPIC victory in GlyphBots Arena—a legendary battle that will be remembered!

Write a dramatic, legendary victory narration. Rules:
1. MAX 5 sentences.
2. This was an extraordinary battle—convey that magnitude.
3. Reference the closeness of the fight.
4. The winner emerged against all odds.
5. This moment is historic.

Style: "And in this moment, legends were born." Epic, mythic, unforgettable.`,

  criticalHit: `You are narrating a devastating critical hit in GlyphBots Arena.

Write an explosive, impactful critical hit moment. Rules:
1. MAX 2-3 sentences.
2. The hit is devastating, spectacular.
3. Time seems to slow down.
4. The crowd gasps.

Style: Slow-motion anime moment. Peak drama.`,
};

/**
 * Build prompt for round narration
 */
export const buildNarrativePrompt = (
  battle: BattleState,
  resolution: CombatResolution
): string => {
  if (!battle.blueFighter) {
    throw new Error("Cannot build narrative prompt without blue fighter");
  }

  const redFighter = battle.redFighter;
  const blueFighter = battle.blueFighter;

  const lines = [
    `ROUND ${battle.round} OF ${battle.maxRounds}`,
    "",
    `RED FIGHTER: ${redFighter.bot.name}`,
    `├─ Faction: ${redFighter.story?.arc?.faction ?? "Unknown"}`,
    `├─ Action: ${redFighter.selectedAction ?? "Strike"}`,
    `├─ Damage Dealt: ${resolution.redDamageDealt}${resolution.redCritical ? " (CRITICAL!)" : ""}`,
    `└─ HP: ${redFighter.hp}/${redFighter.maxHp}`,
    "",
    `BLUE FIGHTER: ${blueFighter.bot.name}`,
    `├─ Faction: ${blueFighter.story?.arc?.faction ?? "Unknown"}`,
    `├─ Action: ${blueFighter.selectedAction ?? "Strike"}`,
    `├─ Damage Dealt: ${resolution.blueDamageDealt}${resolution.blueCritical ? " (CRITICAL!)" : ""}`,
    `└─ HP: ${blueFighter.hp}/${blueFighter.maxHp}`,
    "",
    `ATTACK ORDER: ${resolution.redFirst ? redFighter.bot.name : blueFighter.bot.name} attacks first`,
    "",
    `CROWD ENERGY: ${battle.crowdEnergy}%`,
    battle.crowdBias !== "neutral"
      ? `CROWD FAVORS: ${battle.crowdBias === "red" ? redFighter.bot.name : blueFighter.bot.name}`
      : "",
    "",
    "Write a dramatic 3-4 sentence narration of this combat exchange!",
  ];

  return lines.filter(Boolean).join("\n");
};

/**
 * Build prompt for victory narration
 */
export const buildVictoryPrompt = (
  battle: BattleState,
  winner: FighterState,
  loser: FighterState,
  isEpic: boolean
): string => {
  const lines = [
    "BATTLE COMPLETE",
    "",
    `WINNER: ${winner.bot.name}`,
    `├─ Faction: ${winner.story?.arc?.faction ?? "Unknown"}`,
    `├─ Final HP: ${winner.hp}/${winner.maxHp}`,
    `└─ Owner: ${winner.username}`,
    "",
    `DEFEATED: ${loser.bot.name}`,
    `├─ Faction: ${loser.story?.arc?.faction ?? "Unknown"}`,
    `└─ Owner: ${loser.username}`,
    "",
    `BATTLE DURATION: ${battle.round} rounds`,
    `CROWD ENERGY: ${battle.crowdEnergy}%`,
    `SPECTATORS: ${battle.spectators.size}`,
    "",
    isEpic
      ? "This was an EPIC victory! The battle went to the limit, the crowd was electrified, or the winner barely survived. Make it legendary!"
      : "Write a triumphant but concise victory moment.",
  ];

  return lines.join("\n");
};

/**
 * Get a random arena event description
 */
export const getArenaEventDescription = (
  eventType: "power_surge" | "chaos_field" | "arena_hazard"
): string => {
  const descriptions: Record<string, string[]> = {
    power_surge: [
      "⚡ **POWER SURGE!** Energy crackles through the arena, empowering a random fighter!",
      "⚡ **POWER SURGE!** The arena's core overloads, boosting one combatant's strength!",
      "⚡ **POWER SURGE!** Lightning arcs from the crowd, supercharging a fighter!",
    ],
    chaos_field: [
      "🌀 **CHAOS FIELD!** Reality warps around the fighters—anything could happen!",
      "🌀 **CHAOS FIELD!** The arena destabilizes, granting both fighters unpredictable bonuses!",
      "🌀 **CHAOS FIELD!** Dimensional rifts open, twisting the rules of combat!",
    ],
    arena_hazard: [
      "⚠️ **ARENA HAZARD!** The floor erupts with energy spikes, damaging both fighters!",
      "⚠️ **ARENA HAZARD!** Turrets emerge from the walls, raining fire on the combatants!",
      "⚠️ **ARENA HAZARD!** Gravity fluctuates wildly, throwing both fighters off balance!",
    ],
  };

  const options = descriptions[eventType];
  return options[Math.floor(Math.random() * options.length)];
};
