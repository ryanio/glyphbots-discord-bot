/**
 * Arena Battle State Machine
 *
 * Manages battle state, phase transitions, and fighter status.
 */

import { prefixedLogger } from "../lib/logger";
import type { Bot, BotStory } from "../lib/types";

const log = prefixedLogger("ArenaState");

/** Battle phases */
export type BattlePhase = "challenge" | "prebattle" | "combat" | "finished";

/** Fighter stances */
export type Stance = "aggressive" | "defensive" | "deceptive";

/** Buff/Debuff types */
export type BuffType = "damage" | "defense" | "crit" | "speed";

/** Active buff on a fighter */
export type Buff = {
  type: BuffType;
  value: number;
  duration: number;
  source: string;
};

/** Fighter state in battle */
export type FighterState = {
  userId: string;
  username: string;
  bot: Bot;
  story: BotStory | null;
  hp: number;
  maxHp: number;
  stance: Stance | null;
  selectedAction: string | null;
  buffs: Buff[];
  debuffs: Buff[];
};

/** Spectator state */
export type SpectatorState = {
  odwerId: string;
  cheeredFor: "red" | "blue" | null;
  lastAction: number;
};

/** Round result for battle log */
export type RoundResult = {
  round: number;
  redAction: string;
  blueAction: string;
  redDamageDealt: number;
  blueDamageDealt: number;
  narrative: string;
  criticalHit: boolean;
  imageUrl?: string;
};

/** Battle state */
export type BattleState = {
  id: string;
  arenaChannelId: string;
  announcementMessageId: string | null;
  threadId: string | null;
  threadMessageId: string | null;

  phase: BattlePhase;
  round: number;
  maxRounds: number;

  redFighter: FighterState;
  blueFighter: FighterState | null;

  pendingSpectators: Set<string>;
  spectators: Map<string, SpectatorState>;
  crowdEnergy: number;
  crowdBias: "red" | "blue" | "neutral";

  roundLog: RoundResult[];
  generatedImages: string[];

  createdAt: number;
  expiresAt: number;
  roundStartedAt: number | null;
};

/** Default HP for all fighters */
const DEFAULT_MAX_HP = 100;

/** Challenge timeout in milliseconds (configurable) */
let CHALLENGE_TIMEOUT_MS = 86_400 * 1000; // Default: 24 hours

/** Round timeout in milliseconds (configurable) */
let ROUND_TIMEOUT_MS = 86_400 * 1000; // Default: 24 hours

/** Default max rounds */
const DEFAULT_MAX_ROUNDS = 5;

/** Active battles storage (in-memory) */
const activeBattles = new Map<string, BattleState>();

/** Battles by user ID (for quick lookup) */
const userBattles = new Map<string, string>();

/** Battles by thread ID (for quick lookup) */
const threadBattles = new Map<string, string>();

/**
 * Initialize arena state with config values
 */
export const initArenaState = (
  challengeTimeoutSeconds: number,
  roundTimeoutSeconds: number
): void => {
  CHALLENGE_TIMEOUT_MS = challengeTimeoutSeconds * 1000;
  ROUND_TIMEOUT_MS = roundTimeoutSeconds * 1000;
  log.info(
    `Arena state initialized: challenge timeout=${challengeTimeoutSeconds}s, round timeout=${roundTimeoutSeconds}s`
  );
};

/**
 * Generate a unique battle ID
 */
const generateBattleId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `battle_${timestamp}_${random}`;
};

/**
 * Calculate max HP based on bot stats
 */
const calculateMaxHp = (story: BotStory | null): number => {
  if (!story?.storyStats?.endurance) {
    return DEFAULT_MAX_HP;
  }
  // Base 80 + up to 40 from endurance
  return 80 + Math.floor(story.storyStats.endurance * 0.4);
};

/**
 * Create a new fighter state
 */
export const createFighterState = (
  userId: string,
  username: string,
  bot: Bot,
  story: BotStory | null
): FighterState => {
  const maxHp = calculateMaxHp(story);
  return {
    userId,
    username,
    bot,
    story,
    hp: maxHp,
    maxHp,
    stance: null,
    selectedAction: null,
    buffs: [],
    debuffs: [],
  };
};

/**
 * Create a new battle
 */
export const createBattle = (
  arenaChannelId: string,
  challenger: FighterState,
  maxRounds = DEFAULT_MAX_ROUNDS
): BattleState => {
  const id = generateBattleId();
  const now = Date.now();

  const battle: BattleState = {
    id,
    arenaChannelId,
    announcementMessageId: null,
    threadId: null,
    threadMessageId: null,

    phase: "challenge",
    round: 0,
    maxRounds,

    redFighter: challenger,
    blueFighter: null,

    pendingSpectators: new Set(),
    spectators: new Map(),
    crowdEnergy: 0,
    crowdBias: "neutral",

    roundLog: [],
    generatedImages: [],

    createdAt: now,
    expiresAt: now + CHALLENGE_TIMEOUT_MS,
    roundStartedAt: null,
  };

  activeBattles.set(id, battle);
  userBattles.set(challenger.userId, id);

  log.info(
    `Created battle ${id}: ${challenger.username} (${challenger.bot.name})`
  );

  return battle;
};

/**
 * Get a battle by ID
 */
export const getBattle = (battleId: string): BattleState | undefined =>
  activeBattles.get(battleId);

/**
 * Get a battle by thread ID
 */
export const getBattleByThread = (
  threadId: string
): BattleState | undefined => {
  const battleId = threadBattles.get(threadId);
  return battleId ? activeBattles.get(battleId) : undefined;
};

/**
 * Get a user's active battle
 */
export const getUserBattle = (userId: string): BattleState | undefined => {
  const battleId = userBattles.get(userId);
  return battleId ? activeBattles.get(battleId) : undefined;
};

/**
 * Check if a user is in an active battle
 */
export const isUserInBattle = (userId: string): boolean =>
  userBattles.has(userId);

/**
 * Accept a challenge and set the blue fighter
 */
export const acceptChallenge = (
  battle: BattleState,
  opponent: FighterState
): boolean => {
  if (battle.phase !== "challenge") {
    log.warn(`Cannot accept battle ${battle.id}: not in challenge phase`);
    return false;
  }

  if (battle.redFighter.userId === opponent.userId) {
    log.warn(`Cannot accept battle ${battle.id}: cannot fight yourself`);
    return false;
  }

  battle.blueFighter = opponent;
  battle.phase = "prebattle";
  battle.expiresAt = Date.now() + ROUND_TIMEOUT_MS;

  userBattles.set(opponent.userId, battle.id);

  log.info(
    `Battle ${battle.id} accepted: ${opponent.username} (${opponent.bot.name})`
  );

  return true;
};

/**
 * Set thread ID for a battle
 */
export const setBattleThread = (
  battle: BattleState,
  threadId: string
): void => {
  battle.threadId = threadId;
  threadBattles.set(threadId, battle.id);
};

/**
 * Set announcement message ID
 */
export const setAnnouncementMessage = (
  battle: BattleState,
  messageId: string
): void => {
  battle.announcementMessageId = messageId;
};

/**
 * Add a pending spectator
 */
export const addPendingSpectator = (
  battle: BattleState,
  userId: string
): void => {
  battle.pendingSpectators.add(userId);
};

/**
 * Move pending spectators to active spectators
 */
export const activateSpectators = (battle: BattleState): void => {
  for (const odwerId of battle.pendingSpectators) {
    battle.spectators.set(odwerId, {
      odwerId,
      cheeredFor: null,
      lastAction: Date.now(),
    });
  }
  battle.pendingSpectators.clear();
};

/**
 * Set fighter stance
 */
export const setFighterStance = (
  battle: BattleState,
  odwerId: string,
  stance: Stance
): boolean => {
  if (battle.phase !== "prebattle") {
    return false;
  }

  if (battle.redFighter.userId === odwerId) {
    battle.redFighter.stance = stance;
  } else if (battle.blueFighter?.userId === odwerId) {
    battle.blueFighter.stance = stance;
  } else {
    return false;
  }

  // Check if both fighters have selected stances
  if (battle.redFighter.stance && battle.blueFighter?.stance) {
    battle.phase = "combat";
    battle.round = 1;
    battle.roundStartedAt = Date.now();
    battle.expiresAt = Date.now() + ROUND_TIMEOUT_MS;
    log.info(`Battle ${battle.id} entering combat phase`);
  }

  return true;
};

/**
 * Set fighter action for current round
 */
export const setFighterAction = (
  battle: BattleState,
  odwerId: string,
  action: string
): boolean => {
  if (battle.phase !== "combat") {
    return false;
  }

  if (battle.redFighter.userId === odwerId) {
    battle.redFighter.selectedAction = action;
  } else if (battle.blueFighter?.userId === odwerId) {
    battle.blueFighter.selectedAction = action;
  } else {
    return false;
  }

  return true;
};

/**
 * Check if both fighters have selected actions
 */
export const bothFightersReady = (battle: BattleState): boolean =>
  battle.redFighter.selectedAction !== null &&
  battle.blueFighter?.selectedAction !== null;

/**
 * Record round result and advance
 */
export const recordRoundResult = (
  battle: BattleState,
  result: RoundResult
): void => {
  battle.roundLog.push(result);

  // Clear actions for next round
  battle.redFighter.selectedAction = null;
  if (battle.blueFighter) {
    battle.blueFighter.selectedAction = null;
  }

  // Decrement buff durations
  decrementBuffs(battle.redFighter);
  if (battle.blueFighter) {
    decrementBuffs(battle.blueFighter);
  }

  // Check for victory conditions
  const blueHp = battle.blueFighter?.hp ?? 0;
  if (battle.redFighter.hp <= 0 || blueHp <= 0) {
    battle.phase = "finished";
    log.info(`Battle ${battle.id} finished after round ${battle.round}`);
  } else if (battle.round >= battle.maxRounds) {
    battle.phase = "finished";
    log.info(`Battle ${battle.id} finished: max rounds reached`);
  } else {
    battle.round += 1;
    battle.roundStartedAt = Date.now();
    battle.expiresAt = Date.now() + ROUND_TIMEOUT_MS;
  }
};

/**
 * Decrement buff durations and remove expired
 */
const decrementBuffs = (fighter: FighterState): void => {
  fighter.buffs = fighter.buffs
    .map((b) => ({ ...b, duration: b.duration - 1 }))
    .filter((b) => b.duration > 0);

  fighter.debuffs = fighter.debuffs
    .map((b) => ({ ...b, duration: b.duration - 1 }))
    .filter((b) => b.duration > 0);
};

/**
 * Add crowd energy
 */
export const addCrowdEnergy = (battle: BattleState, amount: number): number => {
  battle.crowdEnergy = Math.min(100, Math.max(0, battle.crowdEnergy + amount));
  return battle.crowdEnergy;
};

/**
 * Apply spectator cheer
 */
export const applySpectatorCheer = (
  battle: BattleState,
  odwerId: string,
  target: "red" | "blue"
): boolean => {
  const spectator = battle.spectators.get(odwerId);
  if (!spectator) {
    return false;
  }

  spectator.cheeredFor = target;
  spectator.lastAction = Date.now();

  // Update crowd bias
  updateCrowdBias(battle);

  return true;
};

/**
 * Update crowd bias based on spectator cheers
 */
const updateCrowdBias = (battle: BattleState): void => {
  let redCheers = 0;
  let blueCheers = 0;

  for (const spectator of battle.spectators.values()) {
    if (spectator.cheeredFor === "red") {
      redCheers += 1;
    } else if (spectator.cheeredFor === "blue") {
      blueCheers += 1;
    }
  }

  if (redCheers > blueCheers) {
    battle.crowdBias = "red";
  } else if (blueCheers > redCheers) {
    battle.crowdBias = "blue";
  } else {
    battle.crowdBias = "neutral";
  }
};

/**
 * Get the winner of a finished battle
 */
export const getWinner = (battle: BattleState): FighterState | null => {
  if (battle.phase !== "finished") {
    return null;
  }

  if (!battle.blueFighter) {
    return null;
  }

  // KO victory
  if (battle.redFighter.hp <= 0 && battle.blueFighter.hp > 0) {
    return battle.blueFighter;
  }
  if (battle.blueFighter.hp <= 0 && battle.redFighter.hp > 0) {
    return battle.redFighter;
  }

  // HP comparison (max rounds reached)
  if (battle.redFighter.hp > battle.blueFighter.hp) {
    return battle.redFighter;
  }
  if (battle.blueFighter.hp > battle.redFighter.hp) {
    return battle.blueFighter;
  }

  // Tie - higher agility wins
  const redAgi = battle.redFighter.story?.storyStats?.agility ?? 50;
  const blueAgi = battle.blueFighter.story?.storyStats?.agility ?? 50;
  return redAgi >= blueAgi ? battle.redFighter : battle.blueFighter;
};

/**
 * Check if battle is an epic victory
 */
export const isEpicVictory = (battle: BattleState): boolean => {
  const winner = getWinner(battle);
  if (!winner) {
    return false;
  }

  // 5+ rounds
  if (battle.round >= 5) {
    return true;
  }

  // 100% crowd energy
  if (battle.crowdEnergy >= 100) {
    return true;
  }

  // Winner has less than 10 HP
  if (winner.hp < 10) {
    return true;
  }

  return false;
};

/**
 * Forfeit a battle
 */
export const forfeitBattle = (
  battle: BattleState,
  odwerId: string
): boolean => {
  if (battle.phase === "finished") {
    return false;
  }

  // Set HP to 0 for the forfeiting player
  if (battle.redFighter.userId === odwerId) {
    battle.redFighter.hp = 0;
  } else if (battle.blueFighter?.userId === odwerId) {
    battle.blueFighter.hp = 0;
  } else {
    return false;
  }

  battle.phase = "finished";
  log.info(`Battle ${battle.id} forfeited by ${odwerId}`);

  return true;
};

/**
 * Cancel a challenge (only if in challenge phase and user is the challenger)
 */
export const cancelChallenge = (
  battle: BattleState,
  userId: string
): boolean => {
  if (battle.phase !== "challenge") {
    log.warn(`Cannot cancel battle ${battle.id}: not in challenge phase`);
    return false;
  }

  if (battle.redFighter.userId !== userId) {
    log.warn(`Cannot cancel battle ${battle.id}: user is not the challenger`);
    return false;
  }

  cleanupBattle(battle.id);
  log.info(`Challenge ${battle.id} canceled by ${userId}`);

  return true;
};

/**
 * Clean up a finished battle
 */
export const cleanupBattle = (battleId: string): void => {
  const battle = activeBattles.get(battleId);
  if (!battle) {
    return;
  }

  // Remove user mappings
  userBattles.delete(battle.redFighter.userId);
  if (battle.blueFighter) {
    userBattles.delete(battle.blueFighter.userId);
  }

  // Remove thread mapping
  if (battle.threadId) {
    threadBattles.delete(battle.threadId);
  }

  // Remove battle
  activeBattles.delete(battleId);

  log.info(`Cleaned up battle ${battleId}`);
};

/**
 * Get all active battles
 */
export const getAllBattles = (): BattleState[] =>
  Array.from(activeBattles.values());

/**
 * Get expired battles
 */
export const getExpiredBattles = (): BattleState[] => {
  const now = Date.now();
  return Array.from(activeBattles.values()).filter(
    (battle) => battle.phase !== "finished" && battle.expiresAt < now
  );
};

/**
 * Get battle count
 */
export const getBattleCount = (): number => activeBattles.size;
