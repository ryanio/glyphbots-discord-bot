/**
 * Name to handler map.
 *
 * Every entry here must have a matching entry in `./definitions.ts` and the
 * other way round; `test/commands.test.ts` asserts that so the two cannot
 * drift. A registered command with no handler is a dead command in front of
 * users, which is the failure this map exists to make impossible.
 */

import { handleActivity } from "./activity";
import { handleArtifact } from "./artifact";
import { handleBot } from "./bot";
import type { CommandHandler } from "./context";
import { handleFloor } from "./floor";
import { handleListings } from "./listings";
import { handleOwner } from "./owner";
import { handleRarity } from "./rarity";
import { handleSales } from "./sales";

export const handlers: Record<string, CommandHandler> = {
  activity: handleActivity,
  artifact: handleArtifact,
  bot: handleBot,
  floor: handleFloor,
  listings: handleListings,
  owner: handleOwner,
  rarity: handleRarity,
  sales: handleSales,
};

export const getHandler = (name: string): CommandHandler | undefined =>
  handlers[name];
