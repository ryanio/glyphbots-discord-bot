/**
 * The OpenSea sales feed, posting to #trading-floor.
 *
 * This absorbs `opensea-activity-bot` (4,940 lines) into one cron tick. What
 * survives is the fetch, the cursor, the settle-window grouping and the Discord
 * embed. What does not: Twitter and its queue (~980 lines, out of scope),
 * `sharp` and the whole image-attachment path (see `./sales-embeds.ts`), the
 * `DEBUG_LOG_FILE` logger, and the `.state/` JSON files.
 *
 * ## The cursor, and the silent failure it used to have
 *
 * The Node cursor resolved through `LAST_EVENT_TIMESTAMP`, then the state file,
 * then **`now`** (`src/opensea.ts:348-385`). That last fallback is the danger:
 * losing the cursor did not error, it silently moved the window to the present
 * and every sale during the gap was skipped forever, with nothing in the logs
 * saying so.
 *
 * The design here is the mint watcher's (`./mints.ts`), which was already
 * right, plus the two things the plan demands of this one specifically:
 *
 * - `lastEventTimestamp` comes from the events' own `event_timestamp`, never
 *   from the wall clock, so a slow tick or a redeploy cannot skip a window.
 * - `grouping.processedKeys` is the real duplicate rejector. The fetch window
 *   deliberately overlaps by `SALES_LAG_WINDOW_SECONDS`, which re-surfaces
 *   recent events on purpose so late-indexed ones are not lost; the key set is
 *   what makes that harmless.
 * - An undelivered message holds the timestamp back to at or below its oldest
 *   event, exactly like a failed mint send, so it stays inside the next fetch
 *   window. Anything already delivered is protected from a repost by its key.
 * - A cold start seeds **explicitly** from the newest event OpenSea reports and
 *   posts nothing. Wall clock is the last resort, it is loud when it happens,
 *   and either way the seed source is logged.
 * - Every tick logs the resolved cursor source. A fallback is then visible in
 *   the logs rather than invisible, which was the whole complaint.
 *
 * ## How grouping survives having no process
 *
 * `EventGroupManager` had no timers; only its `Map` did not survive. The map
 * lives in DO storage now and the flush predicate is untouched. See
 * `./sales-grouping.ts`.
 *
 * ## Why there is no sleep
 *
 * The Node bot paced messages with a 3,000 ms `await timeout`
 * (`discord.ts:155-157`). A cron invocation must not sleep, so pacing is a cap
 * of `SALES_MAX_MESSAGES_PER_TICK` per tick with the remainder carried in
 * `deferred`. Nothing is dropped, it arrives five minutes later.
 */

import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import type { GlyphBotsClient } from "../api/glyphbots";
import type { OpenSeaClient } from "../api/opensea";
import type { OpenSeaEvent } from "../api/types";
import {
  SALES_DEFERRED_QUEUE_MAX,
  SALES_EVENT_TYPES,
  SALES_LAG_WINDOW_SECONDS,
  SALES_MAX_MESSAGES_PER_TICK,
} from "../config";
import type { ChannelPoster } from "../discord/channel-poster";
import { createLogger, getErrorMessage } from "../utils/logger";
import {
  buildGroupEmbed,
  buildSaleEmbed,
  fallbackName,
  type SalesEmbedClients,
} from "./sales-embeds";
import {
  type GroupingState,
  effectiveEventType,
  emptyGroupingState,
  markGroupProcessed,
  markProcessed,
  processEvents,
} from "./sales-grouping";

const log = createLogger("Sales");

const MS_PER_SECOND = 1000;

/**
 * A built message waiting to go out.
 *
 * It carries its own oldest event timestamp because that is what the cursor is
 * held back to while it is undelivered. It does not carry the events: they are
 * already marked processed, and the body is the only thing still needed.
 */
export type PendingMessage = {
  body: RESTPostAPIChannelMessageJSONBody;
  oldestTimestamp: number;
  /** For logs only. */
  label: string;
};

/** Everything the feed needs to survive between cron invocations. */
export type SalesFeedState = {
  /** Unix seconds, taken from event data. */
  lastEventTimestamp: number;
  grouping: GroupingState;
  deferred: PendingMessage[];
};

/** Where the cursor came from on this tick. Logged every time. */
export type CursorSource = "stored" | "seeded-from-events" | "seeded-from-clock";

export type SalesPollDeps = {
  opensea: Pick<OpenSeaClient, "fetchCollectionEventsSince" | "fetchAccount">;
  glyphbots: Pick<GlyphBotsClient, "getBotPngUrl" | "getBotUrl">;
  poster: ChannelPoster;
  store: {
    read: () => Promise<SalesFeedState | null>;
    write: (state: SalesFeedState) => Promise<void>;
  };
  /** Injected in tests. */
  now?: () => number;
};

/**
 * Resolve an address to a display name, once per address per tick.
 *
 * The Node bot kept a process-lifetime LRU (`src/opensea.ts:183-193`). A
 * Worker isolate does not live long enough for that to pay off, and a sweep is
 * one buyer by definition, so the cache is per tick. A lookup failure is not an
 * error: the short address is a perfectly good label.
 */
const createNameResolver = (
  opensea: SalesPollDeps["opensea"]
): ((address: string) => Promise<string>) => {
  const cache = new Map<string, string>();

  return async (address: string): Promise<string> => {
    const key = address.toLowerCase();
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let name = fallbackName(address);
    try {
      const account = await opensea.fetchAccount(address);
      if (account?.username) {
        name = account.username;
      }
    } catch (error) {
      log.debug(`Username lookup failed for ${address}: ${getErrorMessage(error)}`);
    }

    cache.set(key, name);
    return name;
  };
};

/** Only the event types the feed is configured to post. */
const isWanted = (event: OpenSeaEvent): boolean =>
  (SALES_EVENT_TYPES as readonly string[]).includes(effectiveEventType(event));

const oldestTimestampOf = (events: OpenSeaEvent[]): number =>
  events.reduce(
    (oldest, event) => Math.min(oldest, event.event_timestamp),
    Number.POSITIVE_INFINITY
  );

/**
 * Seed the cursor on a cold start, explicitly, and post nothing.
 *
 * The newest event OpenSea reports is the seed, so the cursor is derived from
 * event data on the very first tick just as it is on every tick afterwards.
 * Only when the collection has no events at all does this fall back to the
 * clock, and that case logs at warn level naming the fallback, because it is
 * the one path where a later sale could be missed if the API was merely having
 * a bad minute.
 */
const seedState = async (
  deps: SalesPollDeps,
  now: number
): Promise<SalesFeedState> => {
  const probe = await deps.opensea.fetchCollectionEventsSince({
    after: 0,
    eventTypes: SALES_EVENT_TYPES,
    limit: 1,
    maxPages: 1,
  });

  const newest = probe.events.at(-1);
  let source: CursorSource = "seeded-from-events";
  let lastEventTimestamp: number;

  if (newest && !probe.failed) {
    lastEventTimestamp = newest.event_timestamp;
  } else {
    source = "seeded-from-clock";
    lastEventTimestamp = Math.floor(now / MS_PER_SECOND);
    log.warn(
      `Cold start: OpenSea returned no events${probe.failed ? " (request failed)" : ""}, seeding the sales cursor from the wall clock at ${lastEventTimestamp}. Any sale before this point will not be posted.`
    );
  }

  const state: SalesFeedState = {
    lastEventTimestamp,
    grouping: emptyGroupingState(),
    deferred: [],
  };

  await deps.store.write(state);
  log.info(
    `Sales cursor seeded: source=${source} at=${lastEventTimestamp} (${new Date(lastEventTimestamp * MS_PER_SECOND).toISOString()}), posted nothing`
  );

  return state;
};

/** Build one message per settled group and per individual event. */
const buildMessages = async (
  deps: SalesPollDeps,
  state: SalesFeedState,
  groups: Array<{ events: OpenSeaEvent[] }>,
  individuals: OpenSeaEvent[]
): Promise<PendingMessage[]> => {
  const clients: SalesEmbedClients = {
    glyphbots: deps.glyphbots,
    displayName: createNameResolver(deps.opensea),
  };

  const messages: PendingMessage[] = [];

  for (const group of groups) {
    messages.push({
      body: { embeds: [await buildGroupEmbed(group.events, clients)] },
      oldestTimestamp: oldestTimestampOf(group.events),
      label: `group of ${group.events.length}`,
    });
    // Marked here rather than after the send: the message now owns delivery,
    // and the deferred queue is persisted in the same write as these keys, so
    // the two cannot disagree.
    markGroupProcessed(state.grouping, group.events);
  }

  for (const event of individuals) {
    messages.push({
      body: { embeds: [await buildSaleEmbed(event, clients)] },
      oldestTimestamp: event.event_timestamp,
      label: `sale #${event.nft?.identifier ?? "?"}`,
    });
    markProcessed(state.grouping, event);
  }

  return messages;
};

/**
 * Send up to the per-tick cap, in order, and hand back whatever did not go.
 *
 * A failure stops the run rather than skipping past it, so the channel never
 * shows message three before message two. Everything after the failure keeps
 * its place in the queue.
 */
const sendUpToCap = async (
  deps: SalesPollDeps,
  queue: PendingMessage[]
): Promise<{ sent: number; undelivered: PendingMessage[] }> => {
  const attempts = queue.slice(0, SALES_MAX_MESSAGES_PER_TICK);
  const overflow = queue.slice(SALES_MAX_MESSAGES_PER_TICK);
  const undelivered: PendingMessage[] = [];
  let sent = 0;
  let halted = false;

  for (const message of attempts) {
    if (halted) {
      undelivered.push(message);
      continue;
    }
    try {
      await deps.poster.send(message.body);
      sent += 1;
      log.info(`Posted ${message.label} to #trading-floor`);
    } catch (error) {
      log.error(`Failed to send ${message.label}: ${getErrorMessage(error)}`);
      undelivered.push(message);
      halted = true;
    }
  }

  if (overflow.length > 0) {
    log.warn(
      `Per-tick cap reached, deferring ${overflow.length} message(s) to the next tick`
    );
  }

  return { sent, undelivered: [...undelivered, ...overflow] };
};

/**
 * Run one tick: fetch, group, post, persist. Returns messages sent.
 *
 * Note this runs the grouping pass even when the fetch returned nothing. That
 * empty pass is what flushes a group whose settle window has elapsed, and it is
 * the reason the Node bot called its handlers with empty arrays
 * (`src/index.ts:204-206`).
 */
export const pollSales = async (deps: SalesPollDeps): Promise<number> => {
  const now = deps.now?.() ?? Date.now();
  const stored = await deps.store.read();

  if (!stored) {
    await seedState(deps, now);
    return 0;
  }

  const after = Math.max(0, stored.lastEventTimestamp - SALES_LAG_WINDOW_SECONDS);
  log.info(
    `Sales cursor: source=stored at=${stored.lastEventTimestamp} (${new Date(stored.lastEventTimestamp * MS_PER_SECOND).toISOString()}) fetching after=${after} deferred=${stored.deferred.length}`
  );

  const page = await deps.opensea.fetchCollectionEventsSince({
    after,
    eventTypes: SALES_EVENT_TYPES,
  });

  const fetched = page.events.filter(isWanted);
  if (fetched.length > 0) {
    log.info(`Fetched ${fetched.length} in-scope event(s) across ${page.pages} page(s)`);
  }

  const state: SalesFeedState = {
    lastEventTimestamp: stored.lastEventTimestamp,
    grouping: stored.grouping,
    deferred: stored.deferred,
  };

  const { readyGroups, processableEvents, skippedDupes, skippedPending } =
    processEvents(state.grouping, fetched, now);

  if (skippedDupes > 0 || skippedPending > 0) {
    log.debug(
      `Skipped ${skippedDupes} already-posted and ${skippedPending} awaiting their group`
    );
  }

  const built = await buildMessages(
    deps,
    state,
    readyGroups,
    processableEvents
  );

  // Deferred first: a message that has already waited a tick goes out before
  // anything built this tick, so the channel stays chronological.
  const queue = [...state.deferred, ...built];
  const { sent, undelivered } = await sendUpToCap(deps, queue);

  // Advance from event data only, never the clock. A truncated sweep cannot
  // advance either, because `fetched` is short and the max is taken over what
  // actually arrived.
  let lastEventTimestamp = state.lastEventTimestamp;
  if (!page.failed) {
    for (const event of fetched) {
      if (event.event_timestamp > lastEventTimestamp) {
        lastEventTimestamp = event.event_timestamp;
      }
    }
  }

  const deferred = undelivered.slice(-SALES_DEFERRED_QUEUE_MAX);
  if (undelivered.length > deferred.length) {
    log.error(
      `Deferred queue overflowed, dropped ${undelivered.length - deferred.length} of the oldest message(s)`
    );
  }

  // Hold the cursor back to at or below the oldest undelivered event, the same
  // rewind the mint watcher does on a failed send. Anything already delivered
  // is in `processedKeys`, so the rewind cannot cause a repost.
  for (const message of deferred) {
    if (message.oldestTimestamp < lastEventTimestamp) {
      lastEventTimestamp = message.oldestTimestamp;
    }
  }

  if (deferred.length > 0) {
    log.warn(
      `${deferred.length} message(s) undelivered, cursor held at ${lastEventTimestamp} for the next tick`
    );
  }

  await deps.store.write({
    lastEventTimestamp,
    grouping: state.grouping,
    deferred,
  });

  return sent;
};
