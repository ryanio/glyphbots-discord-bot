/**
 * Arena Spectator System
 *
 * Handles crowd mechanics, cheering, and arena events.
 */

import { prefixedLogger } from "../lib/logger";
import {
  addCrowdEnergy,
  applySpectatorCheer,
  type BattleState,
  type Buff,
} from "./state";

const log = prefixedLogger("ArenaSpectators");

/** Crowd action types */
export type CrowdAction = "cheer_red" | "cheer_blue" | "bloodlust" | "surge";

/** Arena event types */
export type ArenaEventType = "power_surge" | "chaos_field" | "arena_hazard";

/** Arena event result */
export type ArenaEventResult = {
  type: ArenaEventType;
  description: string;
  redEffect?: Buff;
  blueEffect?: Buff;
  redDamage?: number;
  blueDamage?: number;
};

/** Cheer damage bonus percentage */
const CHEER_DAMAGE_BONUS = 5;

/** Bloodlust damage bonus percentage */
const BLOODLUST_DAMAGE_BONUS = 10;

/** Bloodlust defense penalty percentage */
const BLOODLUST_DEFENSE_PENALTY = 10;

/** Surge energy amount */
const SURGE_ENERGY_AMOUNT = 15;

/** Crowd energy threshold for arena event */
const ARENA_EVENT_THRESHOLD = 100;

/**
 * Apply a crowd action from a spectator
 */
export const applyCrowdAction = (
  battle: BattleState,
  odwerId: string,
  action: CrowdAction
): { success: boolean; message: string; triggeredEvent?: ArenaEventResult } => {
  // Check if user is a spectator
  if (!battle.spectators.has(odwerId)) {
    return {
      success: false,
      message: "You are not a spectator in this battle.",
    };
  }

  let message = "";
  let energyAdded = 0;

  switch (action) {
    case "cheer_red":
      applySpectatorCheer(battle, odwerId, "red");
      message = `🔴 You're cheering for ${battle.redFighter.bot.name}. (+${CHEER_DAMAGE_BONUS}% damage next round)`;
      energyAdded = 5;
      break;

    case "cheer_blue":
      if (!battle.blueFighter) {
        return { success: false, message: "No blue fighter to cheer for." };
      }
      applySpectatorCheer(battle, odwerId, "blue");
      message = `🔵 You're cheering for ${battle.blueFighter.bot.name}. (+${CHEER_DAMAGE_BONUS}% damage next round)`;
      energyAdded = 5;
      break;

    case "bloodlust":
      message = `💀 **BLOODLUST!** Both fighters get +${BLOODLUST_DAMAGE_BONUS}% damage, -${BLOODLUST_DEFENSE_PENALTY}% defense!`;
      applyBloodlust(battle);
      energyAdded = 10;
      break;

    case "surge":
      message = `⚡ **SURGE!** +${SURGE_ENERGY_AMOUNT} crowd energy!`;
      energyAdded = SURGE_ENERGY_AMOUNT;
      break;

    default:
      return { success: false, message: "Unknown action." };
  }

  // Add crowd energy
  const newEnergy = addCrowdEnergy(battle, energyAdded);

  // Check for arena event trigger
  let triggeredEvent: ArenaEventResult | undefined;
  if (newEnergy >= ARENA_EVENT_THRESHOLD) {
    triggeredEvent = triggerArenaEvent(battle);
    // Reset crowd energy after event
    battle.crowdEnergy = 0;
  }

  log.info(
    `Crowd action ${action} by ${odwerId}: energy now ${battle.crowdEnergy}%`
  );

  return { success: true, message, triggeredEvent };
};

/**
 * Apply bloodlust buff/debuff to both fighters
 */
const applyBloodlust = (battle: BattleState): void => {
  const bloodlustBuff: Buff = {
    type: "damage",
    value: BLOODLUST_DAMAGE_BONUS,
    duration: 1,
    source: "bloodlust",
  };

  const bloodlustDebuff: Buff = {
    type: "defense",
    value: -BLOODLUST_DEFENSE_PENALTY,
    duration: 1,
    source: "bloodlust",
  };

  battle.redFighter.buffs.push(bloodlustBuff);
  battle.redFighter.debuffs.push(bloodlustDebuff);

  if (battle.blueFighter) {
    battle.blueFighter.buffs.push(bloodlustBuff);
    battle.blueFighter.debuffs.push(bloodlustDebuff);
  }
};

/**
 * Trigger a random arena event
 */
export const triggerArenaEvent = (battle: BattleState): ArenaEventResult => {
  const eventTypes: ArenaEventType[] = [
    "power_surge",
    "chaos_field",
    "arena_hazard",
  ];
  const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

  log.info(`Arena event triggered: ${eventType}`);

  switch (eventType) {
    case "power_surge":
      return applyPowerSurge(battle);
    case "chaos_field":
      return applyChaosField(battle);
    case "arena_hazard":
      return applyArenaHazard(battle);
    default:
      return applyPowerSurge(battle);
  }
};

/**
 * Power Surge: Random fighter gets +20% all stats for 2 rounds
 */
const applyPowerSurge = (battle: BattleState): ArenaEventResult => {
  const targetRed = Math.random() < 0.5;
  const target = targetRed ? battle.redFighter : battle.blueFighter;

  if (!target) {
    return {
      type: "power_surge",
      description: `⚡ **POWER SURGE!** Energy crackles through ${battle.redFighter.bot.name}!`,
      redEffect: {
        type: "damage",
        value: 20,
        duration: 2,
        source: "power_surge",
      },
    };
  }

  const buff: Buff = {
    type: "damage",
    value: 20,
    duration: 2,
    source: "power_surge",
  };

  target.buffs.push(buff);

  return {
    type: "power_surge",
    description: `⚡ **POWER SURGE!** Energy crackles through ${target.bot.name}, boosting their power!`,
    [targetRed ? "redEffect" : "blueEffect"]: buff,
  };
};

/**
 * Chaos Field: Both fighters get random bonus effects
 */
const applyChaosField = (battle: BattleState): ArenaEventResult => {
  const randomBuffType = (): "damage" | "defense" | "crit" | "speed" =>
    (["damage", "defense", "crit", "speed"] as const)[
      Math.floor(Math.random() * 4)
    ];

  const redBuff: Buff = {
    type: randomBuffType(),
    value: 15 + Math.floor(Math.random() * 20),
    duration: 2,
    source: "chaos_field",
  };

  const blueBuff: Buff = {
    type: randomBuffType(),
    value: 15 + Math.floor(Math.random() * 20),
    duration: 2,
    source: "chaos_field",
  };

  battle.redFighter.buffs.push(redBuff);
  if (battle.blueFighter) {
    battle.blueFighter.buffs.push(blueBuff);
  }

  return {
    type: "chaos_field",
    description:
      "🌀 **CHAOS FIELD!** Reality warps around the fighters, granting unpredictable bonuses!",
    redEffect: redBuff,
    blueEffect: blueBuff,
  };
};

/**
 * Arena Hazard: Environmental damage to both fighters based on endurance
 */
const applyArenaHazard = (battle: BattleState): ArenaEventResult => {
  const baseDamage = 15;

  // Higher endurance = less damage taken
  const redEnd = battle.redFighter.story?.storyStats?.endurance ?? 50;
  const blueEnd = battle.blueFighter?.story?.storyStats?.endurance ?? 50;

  const redDamage = Math.max(5, baseDamage - Math.floor(redEnd * 0.1));
  const blueDamage = Math.max(5, baseDamage - Math.floor(blueEnd * 0.1));

  battle.redFighter.hp = Math.max(1, battle.redFighter.hp - redDamage);
  if (battle.blueFighter) {
    battle.blueFighter.hp = Math.max(1, battle.blueFighter.hp - blueDamage);
  }

  return {
    type: "arena_hazard",
    description: `⚠️ **ARENA HAZARD!** Energy spikes erupt from the floor! ${battle.redFighter.bot.name} takes ${redDamage} damage, ${battle.blueFighter?.bot.name ?? "opponent"} takes ${blueDamage} damage!`,
    redDamage,
    blueDamage,
  };
};

/**
 * Calculate crowd bonus for a fighter based on cheers
 */
export const calculateCrowdBonus = (
  battle: BattleState,
  isRed: boolean
): number => {
  let bonus = 0;

  for (const spectator of battle.spectators.values()) {
    if (
      (isRed && spectator.cheeredFor === "red") ||
      (!isRed && spectator.cheeredFor === "blue")
    ) {
      bonus += CHEER_DAMAGE_BONUS;
    }
  }

  // Cap at 50% bonus
  return Math.min(50, bonus);
};

/**
 * Get crowd status message
 */
export const getCrowdStatusMessage = (battle: BattleState): string => {
  const spectatorCount = battle.spectators.size;
  const energyBar =
    "█".repeat(Math.floor(battle.crowdEnergy / 10)) +
    "░".repeat(10 - Math.floor(battle.crowdEnergy / 10));

  let redCheers = 0;
  let blueCheers = 0;
  for (const spectator of battle.spectators.values()) {
    if (spectator.cheeredFor === "red") {
      redCheers += 1;
    } else if (spectator.cheeredFor === "blue") {
      blueCheers += 1;
    }
  }

  const lines = [
    `👥 **SPECTATORS** (${spectatorCount} watching)`,
    "",
    `CROWD ENERGY: ${energyBar} ${battle.crowdEnergy}%`,
    "",
  ];

  if (redCheers > 0 || blueCheers > 0) {
    lines.push(`🔴 ${redCheers} cheering red | 🔵 ${blueCheers} cheering blue`);
  }

  if (battle.crowdEnergy >= 80) {
    lines.push("", "⚡ **CROWD ENERGY CRITICAL!** Arena event imminent.");
  }

  return lines.join("\n");
};
