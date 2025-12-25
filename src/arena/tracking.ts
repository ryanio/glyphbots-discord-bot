/**
 * Arena Win/Loss Tracking
 *
 * Persists battle statistics for users and bots.
 */

import { dirname, join } from "node:path";
import { ensureDirectory, readFileText, writeFileText } from "../lib/fs";
import { prefixedLogger } from "../lib/logger";
import { DEFAULT_STATE_DIR } from "../lib/state";
import type { BattleState, FighterState } from "./state";

const log = prefixedLogger("ArenaTracking");

/** User arena stats */
export type UserArenaStats = {
  odwerId: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
  epicVictories: number;
  totalRounds: number;
  lastBattleAt: number;
};

/** Bot combat stats */
export type BotCombatStats = {
  tokenId: number;
  name: string;
  wins: number;
  losses: number;
  draws: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  criticalHits: number;
  battlesParticipated: number;
};

/** Battle record for history */
export type BattleRecord = {
  id: string;
  timestamp: number;
  redFighterUserId: string;
  redFighterUsername: string;
  redBotTokenId: number;
  redBotName: string;
  blueFighterUserId: string;
  blueFighterUsername: string;
  blueBotTokenId: number;
  blueBotName: string;
  winnerId: string;
  rounds: number;
  epicVictory: boolean;
};

/** Arena stats store */
type ArenaStatsStore = {
  users: Record<string, UserArenaStats>;
  bots: Record<number, BotCombatStats>;
  battleHistory: BattleRecord[];
};

/** Stats file name */
const STATS_FILE = "arena-stats.json";

/** Max battle history entries */
const MAX_BATTLE_HISTORY = 100;

/** Default empty store */
const getEmptyStore = (): ArenaStatsStore => ({
  users: {},
  bots: {},
  battleHistory: [],
});

/** Get stats file path */
const getStatsPath = (): string => {
  const stateDir = process.env.STATE_DIR ?? DEFAULT_STATE_DIR;
  return join(stateDir, STATS_FILE);
};

/**
 * Load stats from disk
 */
const loadStats = async (): Promise<ArenaStatsStore> => {
  try {
    const statsPath = getStatsPath();
    const data = await readFileText(statsPath);
    return JSON.parse(data) as ArenaStatsStore;
  } catch {
    log.info("No existing stats file, starting fresh");
    return getEmptyStore();
  }
};

/**
 * Save stats to disk
 */
const saveStats = async (store: ArenaStatsStore): Promise<void> => {
  try {
    const statsPath = getStatsPath();
    const dir = dirname(statsPath);

    await ensureDirectory(dir);
    await writeFileText(statsPath, JSON.stringify(store, null, 2));

    log.debug("Stats saved successfully");
  } catch (error) {
    log.error("Failed to save stats:", error);
  }
};

/**
 * Get user stats
 */
export const getUserStats = async (
  odwerId: string
): Promise<UserArenaStats | null> => {
  const store = await loadStats();
  return store.users[odwerId] ?? null;
};

/**
 * Get bot combat stats
 */
export const getBotStats = async (
  tokenId: number
): Promise<BotCombatStats | null> => {
  const store = await loadStats();
  return store.bots[tokenId] ?? null;
};

/**
 * Get leaderboard (top users by wins)
 */
export const getLeaderboard = async (limit = 10): Promise<UserArenaStats[]> => {
  const store = await loadStats();
  const users = Object.values(store.users);

  return users
    .sort((a, b) => b.wins - a.wins || b.bestStreak - a.bestStreak)
    .slice(0, limit);
};

/**
 * Get recent battles
 */
export const getRecentBattles = async (limit = 10): Promise<BattleRecord[]> => {
  const store = await loadStats();
  return store.battleHistory.slice(-limit).reverse();
};

/**
 * Record a battle result
 */
export const recordBattleResult = async (
  battle: BattleState,
  winner: FighterState,
  loser: FighterState,
  isEpic: boolean
): Promise<void> => {
  if (!battle.blueFighter) {
    log.warn("Cannot record battle without blue fighter");
    return;
  }

  const store = await loadStats();
  const now = Date.now();

  // Initialize user stats if needed
  const winnerId = winner.userId;
  const loserId = loser.userId;

  if (!store.users[winnerId]) {
    store.users[winnerId] = {
      odwerId: winnerId,
      username: winner.username,
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
      epicVictories: 0,
      totalRounds: 0,
      lastBattleAt: 0,
    };
  }

  if (!store.users[loserId]) {
    store.users[loserId] = {
      odwerId: loserId,
      username: loser.username,
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
      epicVictories: 0,
      totalRounds: 0,
      lastBattleAt: 0,
    };
  }

  // Update winner stats
  store.users[winnerId].wins += 1;
  store.users[winnerId].currentStreak += 1;
  store.users[winnerId].totalRounds += battle.round;
  store.users[winnerId].lastBattleAt = now;
  if (store.users[winnerId].currentStreak > store.users[winnerId].bestStreak) {
    store.users[winnerId].bestStreak = store.users[winnerId].currentStreak;
  }
  if (isEpic) {
    store.users[winnerId].epicVictories += 1;
  }

  // Update loser stats
  store.users[loserId].losses += 1;
  store.users[loserId].currentStreak = 0;
  store.users[loserId].totalRounds += battle.round;
  store.users[loserId].lastBattleAt = now;

  // Update bot stats
  const winnerBotId = winner.bot.tokenId;
  const loserBotId = loser.bot.tokenId;

  if (!store.bots[winnerBotId]) {
    store.bots[winnerBotId] = {
      tokenId: winnerBotId,
      name: winner.bot.name,
      wins: 0,
      losses: 0,
      draws: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      criticalHits: 0,
      battlesParticipated: 0,
    };
  }

  if (!store.bots[loserBotId]) {
    store.bots[loserBotId] = {
      tokenId: loserBotId,
      name: loser.bot.name,
      wins: 0,
      losses: 0,
      draws: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      criticalHits: 0,
      battlesParticipated: 0,
    };
  }

  store.bots[winnerBotId].wins += 1;
  store.bots[winnerBotId].battlesParticipated += 1;
  store.bots[loserBotId].losses += 1;
  store.bots[loserBotId].battlesParticipated += 1;

  // Calculate damage from round log
  for (const round of battle.roundLog) {
    const isWinnerRed = winner === battle.redFighter;
    const winnerDamage = isWinnerRed
      ? round.redDamageDealt
      : round.blueDamageDealt;
    const loserDamage = isWinnerRed
      ? round.blueDamageDealt
      : round.redDamageDealt;

    store.bots[winnerBotId].totalDamageDealt += winnerDamage;
    store.bots[winnerBotId].totalDamageTaken += loserDamage;
    store.bots[loserBotId].totalDamageDealt += loserDamage;
    store.bots[loserBotId].totalDamageTaken += winnerDamage;

    if (round.criticalHit) {
      // We don't know which bot crit, so count for both
      // Could be improved with more detailed round tracking
      store.bots[winnerBotId].criticalHits += 1;
    }
  }

  // Add battle record
  const record: BattleRecord = {
    id: battle.id,
    timestamp: now,
    redFighterUserId: battle.redFighter.userId,
    redFighterUsername: battle.redFighter.username,
    redBotTokenId: battle.redFighter.bot.tokenId,
    redBotName: battle.redFighter.bot.name,
    blueFighterUserId: battle.blueFighter.userId,
    blueFighterUsername: battle.blueFighter.username,
    blueBotTokenId: battle.blueFighter.bot.tokenId,
    blueBotName: battle.blueFighter.bot.name,
    winnerId,
    rounds: battle.round,
    epicVictory: isEpic,
  };

  store.battleHistory.push(record);

  // Trim history if too long
  if (store.battleHistory.length > MAX_BATTLE_HISTORY) {
    store.battleHistory = store.battleHistory.slice(-MAX_BATTLE_HISTORY);
  }

  await saveStats(store);

  log.info(
    `Recorded battle result: ${winner.username} (${winner.bot.name}) defeated ${loser.username} (${loser.bot.name})`
  );
};

/**
 * Get server-wide stats
 */
export const getServerStats = async (): Promise<{
  totalBattles: number;
  totalRounds: number;
  epicVictories: number;
  uniqueFighters: number;
  uniqueBots: number;
}> => {
  const store = await loadStats();

  const users = Object.values(store.users);
  const bots = Object.values(store.bots);

  const totalBattles = store.battleHistory.length;
  const totalRounds = users.reduce((sum, u) => sum + u.totalRounds, 0) / 2; // Divided by 2 since both fighters count rounds
  const epicVictories = users.reduce((sum, u) => sum + u.epicVictories, 0);
  const uniqueFighters = users.length;
  const uniqueBots = bots.length;

  return {
    totalBattles,
    totalRounds: Math.floor(totalRounds),
    epicVictories,
    uniqueFighters,
    uniqueBots,
  };
};
