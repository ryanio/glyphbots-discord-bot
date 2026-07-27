/**
 * The idle nudge: one post into `#general`, because nobody has said anything
 * for two days.
 *
 * This is the only scheduled thing in the package that is not really a
 * schedule. The cron fires hourly, but the cron is a *check*, not a cadence:
 * almost every tick reads the clock, sees the guild is awake or recently
 * nudged, and does nothing at all. Reading `wrangler tail` you will see
 * `Idle nudge: not-quiet` twenty-four times a day, which is the feature
 * working.
 *
 * ## The two numbers, and why both
 *
 * The threshold (48 hours) is measured from the last human message. The
 * cooldown (24 hours) is measured from the last nudge. Neither is sufficient
 * alone: with only a threshold the bot would repost every hour for as long as
 * the silence lasted, and with only a cooldown it would post daily into a busy
 * channel. Together they say what the operator asked for, which is post once a
 * day but only while the room is empty.
 *
 * Any human message pushes the next possible nudge a full 48 hours out, because
 * the threshold is measured from the message rather than from the last check.
 * That is the "it posts because it is quiet" property, stated as arithmetic.
 *
 * ## What resets the clock, and what carefully does not
 *
 * Only a non-bot message in `#general` (`isHumanActivity` in `./idle.ts`). Our
 * own nudge lands in that channel as a `MESSAGE_CREATE` like anything else, and
 * a clock that accepted it would restart its own 48 hours on every post: one
 * nudge, ever. The mint watcher and the sales feed post into `#general` and
 * `#trading-floor` under the same bot account and are ignored for the same
 * reason.
 *
 * ## Cold start
 *
 * An absent record is seeded to the current time and nothing is posted. The
 * alternative, treating "no record" as "silent since the epoch", would have
 * every fresh deploy fire a nudge within the hour whatever the guild was
 * doing. Same shape as the mint watcher's first tick, and for the same reason.
 */

import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import { NUDGE_KIND_ATTEMPTS } from "../config";
import type { ChannelPoster } from "../discord/channel-poster";
import type { IdleStateStore } from "../durable-objects/idle-state-store";
import type { LookupClients } from "../lookups/embeds";
import { createLogger, getErrorMessage } from "../utils/logger";
import { decideNudge, type IdleSkipReason, nextNudgeKind } from "./idle";
import { buildNudgePost, type NudgeContentDeps } from "./nudge-content";

const log = createLogger("Nudge");

const MS_PER_HOUR = 3_600_000;

export type NudgeDeps = {
  clients: LookupClients;
  poster: ChannelPoster;
  store: IdleStateStore;
  /** Injected in tests. */
  now?: () => number;
  randomInt?: (max: number) => number;
  pick?: <T>(items: readonly T[]) => T | undefined;
};

/** What one tick did. Every value is a normal outcome except `send-failed`. */
export type NudgeOutcome =
  | "posted"
  | "seeded"
  | "no-content"
  | "send-failed"
  | IdleSkipReason;

const defaultRandomInt = (max: number): number =>
  Math.floor(Math.random() * max) + 1;

const defaultPick = <T>(items: readonly T[]): T | undefined =>
  items.length === 0
    ? undefined
    : items[Math.floor(Math.random() * items.length)];

/**
 * One idle check.
 *
 * Note what is not written on a failed send: the cooldown. A nudge that Discord
 * rejected has not been seen by anybody, so recording it would buy the guild
 * another day of silence for nothing. The tick returns and the next hour tries
 * again.
 */
export const runIdleNudge = async (deps: NudgeDeps): Promise<NudgeOutcome> => {
  const now = deps.now?.() ?? Date.now();
  const state = await deps.store.read();

  if (state === null || state.lastHumanMessageAtMs === null) {
    await deps.store.apply({ op: "seed", atMs: now });
    log.info("Idle clock seeded on a cold start, posting nothing");
    return "seeded";
  }

  const decision = decideNudge(state, now);

  if (!decision.post) {
    log.debug(`Idle check: ${decision.reason}`);
    return decision.reason;
  }

  const contentDeps: NudgeContentDeps = {
    clients: deps.clients,
    randomInt: deps.randomInt ?? defaultRandomInt,
    pick: deps.pick ?? defaultPick,
  };

  // The chosen kind first, then one fallback. A random token id can be a burned
  // bot and an upstream can be down; beyond one retry a tick that finds nothing
  // is better off spending nothing and checking again in an hour.
  const kinds = [decision.kind, nextNudgeKind(decision.kind)].slice(
    0,
    NUDGE_KIND_ATTEMPTS
  );

  for (const kind of kinds) {
    let body: RESTPostAPIChannelMessageJSONBody | null = null;

    try {
      body = await buildNudgePost(kind, contentDeps);
    } catch (error) {
      // Two ways this throws, and the fallback kind is the answer to both. The
      // embed builders validate through `@sapphire/shapeshift` at call time, so
      // an over-long bot name or a non-absolute URL off either API throws out
      // of the builder; and `nudge-content.ts` wraps neither of its API calls.
      // Unwrapped, a throw aborted the whole tick and the second kind, which is
      // there precisely for a kind that cannot produce anything, was never
      // tried.
      log.error(
        `Idle nudge content failed for ${kind}: ${getErrorMessage(error)}`
      );
      continue;
    }

    if (!body) {
      continue;
    }

    try {
      await deps.poster.send(body);
    } catch (error) {
      log.error(`Idle nudge send failed: ${getErrorMessage(error)}`);
      return "send-failed";
    }

    await deps.store.apply({ op: "nudge", atMs: now, kind });

    const quietHours = Math.floor(
      (now - state.lastHumanMessageAtMs) / MS_PER_HOUR
    );
    log.info(`Idle nudge posted (${kind}) after ${quietHours}h of quiet`);
    return "posted";
  }

  log.warn("Idle nudge had nothing to post, waiting for the next check");
  return "no-content";
};
