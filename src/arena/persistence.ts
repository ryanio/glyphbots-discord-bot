/**
 * Arena State Persistence
 *
 * Handles saving and loading arena battle state to survive bot restarts.
 */

import { dirname, join } from "node:path";
import { ensureDirectory, readFileText, writeFileText } from "../lib/fs";
import { prefixedLogger } from "../lib/logger";
import type { BattleState, SpectatorState } from "./state";

const log = prefixedLogger("ArenaPersistence");

/** Default state directory */
const DEFAULT_STATE_DIR = ".state";

/** Arena state file name */
const ARENA_STATE_FILE_NAME = "arena-state.json";

/** Serializable version of BattleState (Sets/Maps converted to arrays) */
type SerializableBattleState = Omit<
  BattleState,
  "pendingSpectators" | "spectators"
> & {
  pendingSpectators: string[];
  spectators: [string, SpectatorState][];
};

/** Arena state structure */
type ArenaState = {
  battles: SerializableBattleState[];
};

/**
 * Convert BattleState to serializable format
 */
const serializeBattle = (battle: BattleState): SerializableBattleState => ({
  ...battle,
  pendingSpectators: Array.from(battle.pendingSpectators),
  spectators: Array.from(battle.spectators.entries()),
});

/**
 * Convert serializable format back to BattleState
 */
const deserializeBattle = (
  serialized: SerializableBattleState
): BattleState => ({
  ...serialized,
  pendingSpectators: new Set(serialized.pendingSpectators),
  spectators: new Map(serialized.spectators),
});

/**
 * Get the arena state file path
 */
const getArenaStateFilePath = (): string => {
  const rootDir = process.cwd();
  const stateDir = process.env.STATE_DIR ?? DEFAULT_STATE_DIR;
  return join(rootDir, stateDir, ARENA_STATE_FILE_NAME);
};

/**
 * Save arena battles to disk
 */
export const saveArenaState = async (battles: BattleState[]): Promise<void> => {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  try {
    const filePath = getArenaStateFilePath();
    const dir = dirname(filePath);
    await ensureDirectory(dir);

    const state: ArenaState = {
      battles: battles.map(serializeBattle),
    };

    await writeFileText(filePath, JSON.stringify(state, null, 2));
    log.debug(`Saved ${battles.length} battles to ${filePath}`);
  } catch (error) {
    log.error("Failed to save arena state:", error);
  }
};

/**
 * Load arena battles from disk
 */
export const loadArenaState = async (): Promise<BattleState[]> => {
  if (process.env.NODE_ENV === "test") {
    return [];
  }

  try {
    const filePath = getArenaStateFilePath();
    const content = await readFileText(filePath);
    if (!content) {
      return [];
    }

    const state = JSON.parse(content) as ArenaState;
    const battles = state.battles.map(deserializeBattle);

    log.info(`Loaded ${battles.length} battles from ${filePath}`);
    return battles;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.error("Failed to load arena state:", error);
    }
    return [];
  }
};
