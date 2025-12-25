/**
 * Arena Combat Resolution
 *
 * Handles damage calculation, ability resolution, and combat mechanics.
 */

import { prefixedLogger } from "../lib/logger";
import {
  type BattleState,
  type BuffType,
  type FighterState,
  type RoundResult,
  recordRoundResult,
  type Stance,
} from "./state";

const log = prefixedLogger("ArenaCombat");

/** Ability definition */
export type Ability = {
  name: string;
  type: "attack" | "defensive" | "buff";
  damageType: "physical" | "magical";
  powerMultiplier: number;
  effect: string;
  cooldown?: number;
};

/** Damage calculation result */
export type DamageResult = {
  damage: number;
  isCritical: boolean;
  blocked: number;
};

/** Combat round resolution result */
export type CombatResolution = {
  redDamageDealt: number;
  blueDamageDealt: number;
  redCritical: boolean;
  blueCritical: boolean;
  redFirst: boolean;
  events: string[];
};

/** Stance advantages (rock-paper-scissors) */
const STANCE_ADVANTAGES: Record<Stance, Stance> = {
  aggressive: "deceptive",
  defensive: "aggressive",
  deceptive: "defensive",
};

/** Stance multipliers */
const STANCE_MULTIPLIERS = {
  advantage: 1.2,
  disadvantage: 0.8,
  neutral: 1.0,
};

/** Base damage multiplier */
const BASE_DAMAGE_MULTIPLIER = 0.6;

/** Speed bonus multiplier */
const SPEED_BONUS_MULTIPLIER = 1.1;

/** Crowd bonus per energy point */
const CROWD_BONUS_PER_POINT = 0.002;

/** Critical hit damage multiplier */
const CRIT_MULTIPLIER = 1.5;

/** Deceptive stance crit bonus */
const DECEPTIVE_CRIT_BONUS = 20;

/** Base crit chance multiplier from luck */
const LUCK_CRIT_MULTIPLIER = 0.5;

/** Minimum damage */
const MIN_DAMAGE = 1;

/** Defense multiplier from endurance */
const DEFENSE_MULTIPLIER = 0.4;

/**
 * Default abilities for bots without story data
 */
const DEFAULT_ABILITIES: Ability[] = [
  {
    name: "Strike",
    type: "attack",
    damageType: "physical",
    powerMultiplier: 1.0,
    effect: "A basic attack",
  },
  {
    name: "Defend",
    type: "defensive",
    damageType: "physical",
    powerMultiplier: 0.5,
    effect: "Reduce incoming damage by 30%",
  },
  {
    name: "Power Attack",
    type: "attack",
    damageType: "physical",
    powerMultiplier: 1.3,
    effect: "A powerful strike",
  },
];

/**
 * Get stance multiplier
 */
export const getStanceMultiplier = (
  attackerStance: Stance | null,
  defenderStance: Stance | null
): number => {
  if (!(attackerStance && defenderStance)) {
    return STANCE_MULTIPLIERS.neutral;
  }

  if (STANCE_ADVANTAGES[attackerStance] === defenderStance) {
    return STANCE_MULTIPLIERS.advantage;
  }

  if (STANCE_ADVANTAGES[defenderStance] === attackerStance) {
    return STANCE_MULTIPLIERS.disadvantage;
  }

  return STANCE_MULTIPLIERS.neutral;
};

/**
 * Get buff modifier for a specific type
 */
const getBuffModifier = (
  buffs: Array<{ type: BuffType; value: number }>,
  type: BuffType
): number => {
  let modifier = 1.0;
  for (const buff of buffs) {
    if (buff.type === type) {
      modifier += buff.value / 100;
    }
  }
  return modifier;
};

/**
 * Get abilities for a fighter
 */
export const getFighterAbilities = (fighter: FighterState): Ability[] => {
  if (
    !fighter.story?.arc?.abilities ||
    fighter.story.arc.abilities.length === 0
  ) {
    return DEFAULT_ABILITIES;
  }

  return fighter.story.arc.abilities.map((ability) => ({
    name: ability.name,
    type: "attack" as const,
    damageType: "magical" as const,
    powerMultiplier: 1.1,
    effect: ability.effect,
  }));
};

/**
 * Get an ability by name
 */
export const getAbility = (
  fighter: FighterState,
  abilityName: string
): Ability | undefined => {
  const abilities = getFighterAbilities(fighter);
  return abilities.find((a) => a.name === abilityName);
};

/**
 * Get a random ability for AI selection
 */
export const getRandomAbility = (fighter: FighterState): Ability => {
  const abilities = getFighterAbilities(fighter);
  return abilities[Math.floor(Math.random() * abilities.length)];
};

/**
 * Calculate damage
 */
export const calculateDamage = (
  attacker: FighterState,
  defender: FighterState,
  ability: Ability,
  crowdBonus: number
): DamageResult => {
  const stats = attacker.story?.storyStats ?? {
    strength: 50,
    intellect: 50,
    agility: 50,
    luck: 50,
    endurance: 50,
    charisma: 50,
  };

  const defenderStats = defender.story?.storyStats ?? {
    strength: 50,
    intellect: 50,
    agility: 50,
    luck: 50,
    endurance: 50,
    charisma: 50,
  };

  // Base damage from primary stat
  let damage =
    ability.damageType === "physical"
      ? (stats.strength ?? 50) * BASE_DAMAGE_MULTIPLIER
      : (stats.intellect ?? 50) * BASE_DAMAGE_MULTIPLIER;

  // Ability power multiplier
  damage *= ability.powerMultiplier;

  // Speed advantage (first strike bonus)
  if ((stats.agility ?? 50) > (defenderStats.agility ?? 50)) {
    damage *= SPEED_BONUS_MULTIPLIER;
  }

  // Stance modifiers
  damage *= getStanceMultiplier(attacker.stance, defender.stance);

  // Crowd energy bonus (up to +20% at 100 energy)
  damage *= 1 + crowdBonus * CROWD_BONUS_PER_POINT;

  // Buff modifiers
  damage *= getBuffModifier(attacker.buffs, "damage");

  // Critical hit check
  const critChance =
    (stats.luck ?? 50) * LUCK_CRIT_MULTIPLIER +
    (attacker.stance === "deceptive" ? DECEPTIVE_CRIT_BONUS : 0);
  const isCrit = Math.random() * 100 < critChance;

  if (isCrit) {
    damage *= CRIT_MULTIPLIER;
  }

  // Defense reduction
  const defense = (defenderStats.endurance ?? 50) * DEFENSE_MULTIPLIER;
  const defenseMultiplier = getBuffModifier(defender.buffs, "defense");

  // Apply defense (defensive ability gives 30% damage reduction)
  let blocked = defense * defenseMultiplier;
  if (ability.type === "defensive") {
    blocked *= 1.3;
  }

  damage = Math.max(MIN_DAMAGE, damage - blocked);

  return {
    damage: Math.round(damage),
    isCritical: isCrit,
    blocked: Math.round(blocked),
  };
};

/**
 * Determine attack order based on agility
 */
export const getAttackOrder = (
  battle: BattleState
): { first: FighterState; second: FighterState } => {
  if (!battle.blueFighter) {
    throw new Error("Cannot determine attack order without blue fighter");
  }

  const redAgi = battle.redFighter.story?.storyStats?.agility ?? 50;
  const blueAgi = battle.blueFighter.story?.storyStats?.agility ?? 50;

  // Add small random factor to break ties
  const redSpeed = redAgi + Math.random() * 5;
  const blueSpeed = blueAgi + Math.random() * 5;

  if (redSpeed >= blueSpeed) {
    return { first: battle.redFighter, second: battle.blueFighter };
  }
  return { first: battle.blueFighter, second: battle.redFighter };
};

/** Calculate crowd bonuses based on crowd bias */
const getCrowdBonuses = (
  crowdEnergy: number,
  crowdBias: "red" | "blue" | "neutral"
): { red: number; blue: number } => {
  if (crowdBias === "red") {
    return { red: crowdEnergy * 0.7, blue: crowdEnergy * 0.3 };
  }
  if (crowdBias === "blue") {
    return { red: crowdEnergy * 0.3, blue: crowdEnergy * 0.7 };
  }
  return { red: crowdEnergy / 2, blue: crowdEnergy / 2 };
};

type AttackEventOpts = {
  botName: string;
  action: string;
  damage: number;
  isCritical: boolean;
};

/** Format attack event message */
const formatAttackEvent = (opts: AttackEventOpts): string =>
  `${opts.botName} used ${opts.action} for ${opts.damage} damage${opts.isCritical ? " (CRITICAL!)" : ""}`;

type ApplyAttacksOpts = {
  battle: BattleState;
  redAction: string;
  blueAction: string;
  redDamage: { damage: number; isCritical: boolean };
  blueDamage: { damage: number; isCritical: boolean };
  isRedFirst: boolean;
};

/** Apply attacks and build event log */
const applyAttacks = (opts: ApplyAttacksOpts): string[] => {
  const { battle, redAction, blueAction, redDamage, blueDamage, isRedFirst } =
    opts;
  const events: string[] = [];
  const { redFighter, blueFighter } = battle;

  if (!blueFighter) {
    return events;
  }

  if (isRedFirst) {
    blueFighter.hp -= redDamage.damage;
    events.push(
      formatAttackEvent({
        botName: redFighter.bot.name,
        action: redAction,
        damage: redDamage.damage,
        isCritical: redDamage.isCritical,
      })
    );
    if (blueFighter.hp > 0) {
      redFighter.hp -= blueDamage.damage;
      events.push(
        formatAttackEvent({
          botName: blueFighter.bot.name,
          action: blueAction,
          damage: blueDamage.damage,
          isCritical: blueDamage.isCritical,
        })
      );
    }
  } else {
    redFighter.hp -= blueDamage.damage;
    events.push(
      formatAttackEvent({
        botName: blueFighter.bot.name,
        action: blueAction,
        damage: blueDamage.damage,
        isCritical: blueDamage.isCritical,
      })
    );
    if (redFighter.hp > 0) {
      blueFighter.hp -= redDamage.damage;
      events.push(
        formatAttackEvent({
          botName: redFighter.bot.name,
          action: redAction,
          damage: redDamage.damage,
          isCritical: redDamage.isCritical,
        })
      );
    }
  }

  // Ensure HP doesn't go below 0
  redFighter.hp = Math.max(0, redFighter.hp);
  blueFighter.hp = Math.max(0, blueFighter.hp);

  return events;
};

/**
 * Resolve a combat round
 */
export const resolveCombatRound = (
  battle: BattleState,
  _narrativeCallback?: (result: CombatResolution) => Promise<string>
): CombatResolution => {
  if (!battle.blueFighter) {
    throw new Error("Cannot resolve combat without blue fighter");
  }

  // Get actions (use random if not selected - timeout case)
  const redAction =
    battle.redFighter.selectedAction ??
    getRandomAbility(battle.redFighter).name;
  const blueAction =
    battle.blueFighter.selectedAction ??
    getRandomAbility(battle.blueFighter).name;

  const redAbility =
    getAbility(battle.redFighter, redAction) ?? DEFAULT_ABILITIES[0];
  const blueAbility =
    getAbility(battle.blueFighter, blueAction) ?? DEFAULT_ABILITIES[0];

  // Determine attack order
  const { first } = getAttackOrder(battle);
  const isRedFirst = first === battle.redFighter;

  // Calculate crowd bonuses
  const crowdBonuses = getCrowdBonuses(battle.crowdEnergy, battle.crowdBias);

  // Calculate damage
  const redDamageResult = calculateDamage(
    battle.redFighter,
    battle.blueFighter,
    redAbility,
    crowdBonuses.red
  );
  const blueDamageResult = calculateDamage(
    battle.blueFighter,
    battle.redFighter,
    blueAbility,
    crowdBonuses.blue
  );

  // Apply damage and get events
  const events = applyAttacks({
    battle,
    redAction,
    blueAction,
    redDamage: redDamageResult,
    blueDamage: blueDamageResult,
    isRedFirst,
  });

  log.info(
    `Round ${battle.round}: Red ${battle.redFighter.hp}HP, Blue ${battle.blueFighter.hp}HP`
  );

  return {
    redDamageDealt: redDamageResult.damage,
    blueDamageDealt: blueDamageResult.damage,
    redCritical: redDamageResult.isCritical,
    blueCritical: blueDamageResult.isCritical,
    redFirst: isRedFirst,
    events,
  };
};

/**
 * Complete a combat round with narrative
 */
export const completeCombatRound = async (
  battle: BattleState,
  generateNarrative: (
    battleState: BattleState,
    resolution: CombatResolution
  ) => Promise<string>
): Promise<RoundResult> => {
  const resolution = resolveCombatRound(battle);
  const narrative = await generateNarrative(battle, resolution);

  const isCritical = resolution.redCritical || resolution.blueCritical;

  const result: RoundResult = {
    round: battle.round,
    redAction: battle.redFighter.selectedAction ?? "Strike",
    blueAction: battle.blueFighter?.selectedAction ?? "Strike",
    redDamageDealt: resolution.redDamageDealt,
    blueDamageDealt: resolution.blueDamageDealt,
    narrative,
    criticalHit: isCritical,
  };

  // Record the result and advance battle state
  recordRoundResult(battle, result);

  return result;
};
