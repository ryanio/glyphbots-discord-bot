/**
 * The OpenSea sales feed, posting to #trading-floor.
 *
 * It covers both collections. OpenSea scopes its events endpoint by collection
 * and the bots and the artifacts are two of them, so a tick sweeps both slugs
 * and merges the result: see `sweepWatchedCollections` below and
 * `../api/collections.ts` for the descriptors. One cursor covers both, which is
 * what keeps the merge honest, and everything downstream asks which collection
 * an event came from rather than assuming.
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
 * then **`now`** (`opensea-activity-bot/src/opensea.ts:348-385`). That last
 * fallback is the danger:
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
 * ## Where the state is merged
 *
 * Not here. A tick reads the record, sweeps OpenSea, posts, and then sends a
 * `commit` operation; `applySalesUpdate` runs it inside `FeedStateDO`. The
 * cursor arithmetic below decides what to *ask* for, and the DO decides what
 * the record becomes. `processedKeys` is the reason it has to work that way: it
 * is the only thing standing between a re-served event and a duplicate post,
 * and a whole-value write computed out here would drop an overlapping tick's
 * keys. See `src/durable-objects/feed-stores.ts`.
 *
 * ## Why there is no sleep
 *
 * The Node bot paced messages with a 3,000 ms `await timeout`
 * (`discord.ts:155-157`). A cron invocation must not sleep, so pacing is a cap
 * of `SALES_MAX_MESSAGES_PER_TICK` per tick with the remainder carried in
 * `deferred`. Nothing is dropped, it arrives five minutes later.
 */

import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import { createArtifactDetails } from "../api/artifact-details";
import { collectionOf, WATCHED_COLLECTIONS } from "../api/collections";
import { createDisplayNameResolver } from "../api/display-name";
import type { GlyphBotsClient } from "../api/glyphbots";
import type { EventsSincePage, OpenSeaClient } from "../api/opensea";
import { createRarityRanks } from "../api/rarity-ranks";
import type { OpenSeaEvent } from "../api/types";
import {
  SALES_DEFERRED_QUEUE_MAX,
  SALES_EVENT_TYPES,
  SALES_LAG_WINDOW_SECONDS,
  SALES_MAX_MESSAGES_PER_TICK,
  SALES_PROCESSED_KEY_HISTORY,
} from "../config";
import type { ChannelPoster } from "../discord/channel-poster";
import type { SalesStateStore } from "../durable-objects/feed-stores";
import { createLogger, getErrorMessage } from "../utils/logger";
import { MS_PER_SECOND } from "../utils/time";
import { createSaleClassifier, type SaleKind } from "./sale-kind";
import {
  buildGroupEmbed,
  buildSaleEmbed,
  type SalesEmbedClients,
} from "./sales-embeds";
import {
  effectiveEventType,
  emptyGroupingState,
  type GroupingState,
  markGroupProcessed,
  markProcessed,
  processEvents,
} from "./sales-grouping";

const log = createLogger("Sales");

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
export type CursorSource =
  | "stored"
  | "seeded-from-events"
  | "seeded-from-clock";

/**
 * Every mutation the sales record accepts. Applied inside the DO.
 *
 * `commit` describes what one tick did rather than handing over a whole
 * record, because everything between reading the record and writing it back is
 * network: an OpenSea sweep, up to five Discord posts. A whole-value write
 * computed on the Worker side is a read-modify-write with all of that in the
 * middle, and the half that matters is `processedKeys`: lose one tick's keys
 * and the sale it just posted goes out again.
 */
export type SalesUpdate =
  | { op: "seed"; at: number }
  | {
      op: "commit";
      /** Every key this tick has taken responsibility for delivering. */
      processedKeys: string[];
      /** Pending settle-window groups, as this tick left them. */
      actorGroups: GroupingState["actorGroups"];
      /** Built but undelivered, oldest first. Sent before anything new. */
      deferred: PendingMessage[];
      /**
       * The furthest the sweep proved it had read, or `null` when the sweep
       * failed and the cursor must not move at all.
       */
      advanceTo: number | null;
    };

export type SalesPollDeps = {
  opensea: Pick<
    OpenSeaClient,
    "fetchCollectionEventsSince" | "fetchAccount" | "fetchOrder"
  >;
  glyphbots: Pick<
    GlyphBotsClient,
    | "fetchArtifact"
    | "fetchBots"
    | "getArtifactUrl"
    | "getBotPngUrl"
    | "getBotUrl"
  >;
  poster: ChannelPoster;
  store: SalesStateStore;
  /** Injected in tests. */
  now?: () => number;
};

/**
 * One sweep across every watched collection, merged into a single page.
 *
 * The endpoint is scoped by collection, so this is one request per collection
 * per page. They go out together: two concurrent sweeps of a handful of pages
 * each is well inside the subrequest budget, and a tick that waited for the
 * bots before starting the artifacts would double the latency of the slowest
 * part of the tick for nothing.
 *
 * The two flags combine pessimistically, and deliberately. `failed` anywhere
 * stops the cursor moving at all; `truncated` anywhere makes the whole sweep
 * truncated. The cursor is one number covering both collections and there is no
 * way to say "caught up on bots, behind on artifacts" in it, so the honest
 * reading of a partial sweep is the more conservative one. The cost is
 * re-reading a window that `processedKeys` already rejects, which is the cheap
 * direction to be wrong in.
 */
export const sweepWatchedCollections = async (
  opensea: Pick<OpenSeaClient, "fetchCollectionEventsSince">,
  options: { after: number; limit?: number; maxPages?: number }
): Promise<EventsSincePage> => {
  const pages = await Promise.all(
    WATCHED_COLLECTIONS.map((collection) =>
      opensea.fetchCollectionEventsSince({
        ...options,
        eventTypes: SALES_EVENT_TYPES,
        slug: collection.slug,
      })
    )
  );

  return {
    // Oldest first across both, which is the order the feed posts in. Each
    // sweep is already sorted; interleaving them is what makes a bot sale and
    // an artifact sale from the same minute read in the order they happened.
    events: pages
      .flatMap((page) => page.events)
      .sort((a, b) => a.event_timestamp - b.event_timestamp),
    pages: pages.reduce((total, page) => total + page.pages, 0),
    failed: pages.some((page) => page.failed),
    truncated: pages.some((page) => page.truncated),
  };
};

export const emptySalesState = (at: number): SalesFeedState => ({
  lastEventTimestamp: at,
  grouping: emptyGroupingState(),
  deferred: [],
});

/**
 * Apply one operation to the sales record. Pure, and run inside the DO.
 *
 * Three rules, and only the first is new arithmetic:
 *
 * - **The key sets are unioned, never replaced.** A tick that overlapped this
 *   one has already posted the sales behind its keys, and replacing the set
 *   with this tick's view would let the lag window re-serve them.
 * - **The cursor only moves forward**, whatever `advanceTo` says. It was
 *   computed against the record as this tick read it, which may be behind the
 *   record as it now stands.
 * - **Then it is held back** to at or below the oldest undelivered message,
 *   the same rewind the mint watcher does on a failed send. Doing it here
 *   rather than on the Worker side is what makes the hold-back and the queue a
 *   single write.
 *
 * The pending groups and the queue are this tick's view outright. Merging two
 * half-finished settle windows is not a well-defined operation, and unlike the
 * key set, getting it wrong delays a message rather than duplicating one.
 */
export const applySalesUpdate = (
  current: SalesFeedState | null,
  update: SalesUpdate
): SalesFeedState => {
  if (update.op === "seed") {
    // Never overwrites a record that exists: two ticks that both read `null`
    // would otherwise both seed, and the second would move the cursor to a
    // point the first had already passed.
    return current ?? emptySalesState(update.at);
  }

  const base = current ?? emptySalesState(0);

  const processedKeys = [...base.grouping.processedKeys];
  for (const key of update.processedKeys) {
    if (!processedKeys.includes(key)) {
      processedKeys.push(key);
    }
  }

  let lastEventTimestamp =
    update.advanceTo === null
      ? base.lastEventTimestamp
      : Math.max(base.lastEventTimestamp, update.advanceTo);

  for (const message of update.deferred) {
    if (message.oldestTimestamp < lastEventTimestamp) {
      lastEventTimestamp = message.oldestTimestamp;
    }
  }

  return {
    lastEventTimestamp,
    grouping: {
      actorGroups: update.actorGroups,
      processedKeys: processedKeys.slice(-SALES_PROCESSED_KEY_HISTORY),
    },
    deferred: update.deferred,
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
  // Both collections, one event each, and the newer of the two wins. Seeding
  // from a single collection would leave the cursor behind whatever the other
  // one had already done, and the first real tick would post that as news.
  const probe = await sweepWatchedCollections(deps.opensea, {
    after: 0,
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

  // The DO refuses to re-seed a record that already exists, so what comes back
  // is the live cursor rather than necessarily the one computed above. Log the
  // live one: a tick that lost that race must not claim to have set it.
  const state = await deps.store.apply({ op: "seed", at: lastEventTimestamp });
  const at = state.lastEventTimestamp;
  log.info(
    `Sales cursor seeded: source=${source} at=${at} (${new Date(at * MS_PER_SECOND).toISOString()}), posted nothing`
  );

  return state;
};

/**
 * Build one message per settled group and per individual event.
 *
 * Every build is wrapped on its own. `EmbedBuilder` validates through
 * `@sapphire/shapeshift` at call time, and both `itemLabel` (into `setTitle`)
 * and `itemUrl` (into `setURL`) are fed straight from OpenSea's `nft.name` and
 * `nft.opensea_url`, so one event carrying a 300 character name or a
 * non-absolute URL used to throw out of here, out of `pollSales`, and take the
 * entire tick with it: nothing posted, cursor unmoved, same throw five minutes
 * later. Per-item, the rest of the batch still goes out.
 *
 * A failed build still marks its events processed. The failure is a validation
 * error on fixed data, so it will fail identically on every retry; leaving the
 * keys off would only re-throw the same event each tick for as long as the lag
 * window keeps re-serving it. One sale is dropped, loudly, and the feed lives.
 *
 * The name resolver, the rank resolver and the sale classifier are all built
 * once for the whole batch rather than per message, which is where the caching
 * lives: a sweep is one buyer and usually one standing order, so N events cost
 * one account lookup, one order lookup and one rank lookup between them.
 */
const buildMessages = async (
  deps: SalesPollDeps,
  state: SalesFeedState,
  groups: Array<{ events: OpenSeaEvent[] }>,
  individuals: OpenSeaEvent[]
): Promise<PendingMessage[]> => {
  const names = createDisplayNameResolver(deps.opensea);
  const ranks = createRarityRanks(deps.glyphbots);
  const artifacts = createArtifactDetails(deps.glyphbots);

  // Every bot this tick will render, asked for once, before any embed is
  // built. Without this each embed would fetch its own and a sweep of ten
  // would be ten requests. A failure here is silent by design: the ranks come
  // back empty and the embeds go out without them.
  //
  // Bots only. `/api/bots` answers by token id with no idea which collection
  // the number came from, so priming it with artifact ids would cache the rank
  // of whichever bot shares each number.
  await ranks.ranks(
    [...groups.flatMap((group) => group.events), ...individuals]
      .filter((event) => collectionOf(event).key === "bots")
      .map((event) => Number(event.nft?.identifier))
  );

  const clients: SalesEmbedClients = {
    glyphbots: deps.glyphbots,
    displayName: names.resolve,
    rarityRank: ranks.rank,
    artifact: artifacts.get,
  };
  const classify = createSaleClassifier(deps.opensea);

  const messages: PendingMessage[] = [];

  for (const group of groups) {
    try {
      // Classified before the build so a group of six that all filled one
      // collection offer is titled as the sweep it was.
      const kinds: SaleKind[] = [];
      for (const event of group.events) {
        kinds.push(await classify(event));
      }
      const collection = collectionOf(group.events[0] ?? ({} as OpenSeaEvent));
      messages.push({
        body: { embeds: [await buildGroupEmbed(group.events, clients, kinds)] },
        oldestTimestamp: oldestTimestampOf(group.events),
        label: `group of ${group.events.length} ${collection.plural}`,
      });
    } catch (error) {
      log.error(
        `Failed to build the embed for a group of ${group.events.length}, dropping it: ${getErrorMessage(error)}`
      );
    }
    // Marked here rather than after the send: the message now owns delivery,
    // and the deferred queue is persisted in the same write as these keys, so
    // the two cannot disagree.
    markGroupProcessed(state.grouping, group.events);
  }

  for (const event of individuals) {
    try {
      const kind = await classify(event);
      messages.push({
        body: { embeds: [await buildSaleEmbed(event, clients, kind)] },
        oldestTimestamp: event.event_timestamp,
        label: `${collectionOf(event).noun} #${event.nft?.identifier ?? "?"} (${kind})`,
      });
    } catch (error) {
      log.error(
        `Failed to build the embed for ${collectionOf(event).noun} #${event.nft?.identifier ?? "?"}, dropping it: ${getErrorMessage(error)}`
      );
    }
    markProcessed(state.grouping, event);
  }

  return messages;
};

/**
 * Where the cursor lands after a sweep.
 *
 * A completed sweep advances to the newest event it saw, which is the original
 * rule and still the common case. A truncated one must not. OpenSea serves
 * newest first, so the events the page budget could not reach are the OLDEST
 * in the window, and jumping to the newest steps over every one of them
 * without a word. It advances to the oldest event it did fetch instead, which
 * is the honest watermark: everything at or above this has been seen.
 *
 * That rule has a fixed point, and the third branch is what breaks it. The
 * next sweep starts at `oldest - SALES_LAG_WINDOW_SECONDS`, so it re-reads the
 * same window, truncates in the same place and computes the same oldest.
 * Left alone the cursor would never move again and every tick would burn ten
 * pages re-reading events it has already posted. So a truncated sweep that
 * made no progress gives the unreachable tail up, advances past it and says so
 * at error level. Those events are lost; the fix for that is a bigger page
 * budget, not a cursor that quietly claims to have read them.
 */
export const advanceSalesCursor = (
  stored: number,
  events: OpenSeaEvent[],
  truncated: boolean
): { at: number; abandonedBelow: number | null } => {
  let newest: number | null = null;
  let oldest: number | null = null;

  for (const event of events) {
    if (newest === null || event.event_timestamp > newest) {
      newest = event.event_timestamp;
    }
    if (oldest === null || event.event_timestamp < oldest) {
      oldest = event.event_timestamp;
    }
  }

  if (newest === null || oldest === null) {
    return { at: stored, abandonedBelow: null };
  }

  if (!truncated) {
    return { at: Math.max(stored, newest), abandonedBelow: null };
  }

  if (oldest > stored) {
    return { at: oldest, abandonedBelow: null };
  }

  return { at: Math.max(stored, newest), abandonedBelow: oldest };
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
 * (`opensea-activity-bot/src/index.ts:204-206`).
 */
export const pollSales = async (deps: SalesPollDeps): Promise<number> => {
  const now = deps.now?.() ?? Date.now();
  const stored = await deps.store.read();

  if (!stored) {
    await seedState(deps, now);
    return 0;
  }

  const after = Math.max(
    0,
    stored.lastEventTimestamp - SALES_LAG_WINDOW_SECONDS
  );
  log.info(
    `Sales cursor: source=stored at=${stored.lastEventTimestamp} (${new Date(stored.lastEventTimestamp * MS_PER_SECOND).toISOString()}) fetching after=${after} deferred=${stored.deferred.length}`
  );

  const page = await sweepWatchedCollections(deps.opensea, { after });

  const fetched = page.events.filter(isWanted);
  if (fetched.length > 0) {
    const byCollection = WATCHED_COLLECTIONS.map(
      (collection) =>
        `${collection.key}=${fetched.filter((event) => collectionOf(event) === collection).length}`
    ).join(" ");
    log.info(
      `Fetched ${fetched.length} in-scope event(s) across ${page.pages} page(s): ${byCollection}`
    );
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

  // Advance from event data only, never the clock. A failed sweep does not
  // advance at all, and a truncated one advances only as far as it actually
  // read: see `advanceSalesCursor`, which is where the newest-first ordering
  // is reasoned about.
  let advanceTo: number | null = null;
  if (!page.failed) {
    const advanced = advanceSalesCursor(
      state.lastEventTimestamp,
      fetched,
      page.truncated
    );
    advanceTo = advanced.at;

    if (page.truncated) {
      log.warn(
        `Sweep truncated at ${page.pages} pages, cursor advanced to ${advanced.at} rather than to the newest event fetched`
      );
    }
    if (advanced.abandonedBelow !== null) {
      log.error(
        `Sweep truncated again without moving the cursor; giving up on events older than ${advanced.abandonedBelow} (${new Date(advanced.abandonedBelow * MS_PER_SECOND).toISOString()}). They will not be posted. Raise SALES_MAX_PAGES if this recurs.`
      );
    }
  }

  const deferred = undelivered.slice(-SALES_DEFERRED_QUEUE_MAX);
  if (undelivered.length > deferred.length) {
    log.error(
      `Deferred queue overflowed, dropped ${undelivered.length - deferred.length} of the oldest message(s)`
    );
  }

  if (deferred.length > 0) {
    log.warn(
      `${deferred.length} message(s) undelivered, holding the cursor back to the oldest of them for the next tick`
    );
  }

  // The cursor arithmetic, the hold-back and the key merge all happen inside
  // the DO. Everything above this line is an OpenSea sweep and up to five
  // Discord posts, so computing the next record here would make the tick a
  // read-modify-write with all of that in the middle.
  const committed = await deps.store.apply({
    op: "commit",
    processedKeys: state.grouping.processedKeys,
    actorGroups: state.grouping.actorGroups,
    deferred,
    advanceTo,
  });

  log.debug(`Sales cursor committed at ${committed.lastEventTimestamp}`);

  return sent;
};
