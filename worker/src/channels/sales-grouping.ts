/**
 * The settle-window batcher, ported from
 * `opensea-activity-bot/src/utils/event-grouping.ts:57-361`.
 *
 * A buyer sweeping ten items should produce one message, not ten. The Node
 * implementation is a class holding a `Map` of pending groups and a 2,000
 * entry LRU of processed events, which looks like it needs a process that
 * stays alive. It does not, and that is the whole reason grouping survives the
 * move to a cron:
 *
 * - There are no timers anywhere in it. Flushing is entirely poll-driven,
 *   which is why the Node bot calls its platform handlers even when the fetch
 *   returned zero events (`src/index.ts:204-206`): the empty call is the
 *   flush.
 * - The flush predicate is a pure function of persisted state and `now`:
 *   `rawCount >= minGroupSize && now - lastAddedMs >= settleMs`
 *   (`event-grouping.ts:206-225`). It is reproduced here unchanged.
 *
 * So the only thing that actually broke was where the map lived. This module
 * is the same algorithm rewritten as functions over a plain JSON object, so
 * the whole thing round-trips through `FeedStateDO` storage between cron
 * invocations. A `Map` becomes a `Record`, a `Set` becomes a bounded array,
 * and nothing else changes.
 *
 * Two other deliberate differences from the source:
 *
 * - The source keeps two key spaces, `eventKeyFor` (`ts|token|type`) for the
 *   per-group dedupe and `canonicalEventKeyFor` for the cross-tick watermark.
 *   Here there is one key, the canonical one, used for both. It is strictly
 *   more precise than the short form and one key space is one thing to reason
 *   about.
 * - The four runtime `require()` calls in the source
 *   (`event-grouping.ts:496,542,547,671`) do not survive bundling. Everything
 *   is a static import, and the Twitter-only text formatters those `require`s
 *   fed are not ported at all.
 */

import type { OpenSeaEvent } from "../api/types";
import {
  GLYPHBOTS_CONTRACT,
  OPENSEA_CHAIN,
  SALES_GROUP_STALE_MULTIPLIER,
  SALES_MIN_GROUP_SIZE,
  SALES_PROCESSED_KEY_HISTORY,
  SALES_SETTLE_MS,
} from "../config";
import { createLogger } from "../utils/logger";

const log = createLogger("Sales/group");

/** One actor's pending events. The `Map` value from `event-grouping.ts:61-69`. */
export type ActorGroup = {
  events: OpenSeaEvent[];
  lastAddedMs: number;
  dedupeKeys: string[];
  /** Counts every add including duplicates, which is what gates the flush. */
  rawCount: number;
};

/** Everything the batcher needs to survive an invocation boundary. */
export type GroupingState = {
  actorGroups: Record<string, ActorGroup>;
  /** Bounded, newest last. The real duplicate rejector. */
  processedKeys: string[];
};

export type GroupConfig = {
  settleMs: number;
  minGroupSize: number;
};

export const DEFAULT_GROUP_CONFIG: GroupConfig = {
  settleMs: SALES_SETTLE_MS,
  minGroupSize: SALES_MIN_GROUP_SIZE,
};

export const emptyGroupingState = (): GroupingState => ({
  actorGroups: {},
  processedKeys: [],
});

/** A settled group, ready to become one message. */
export type ReadyGroup = {
  /** `actor:<key>`, the pseudo transaction hash from `event-grouping.ts:179`. */
  tx: string;
  events: OpenSeaEvent[];
};

/**
 * Stable identity for one event, ported from `canonical-events.ts:6-33`.
 *
 * Sales carry a transaction hash. Orders do not, and fall back to the order
 * hash plus token and quantity, exactly as the source does, so a listing and
 * its relist an hour later are different keys.
 */
export const eventKeyFor = (event: OpenSeaEvent): string => {
  const tokenId = event.nft?.identifier ?? "";
  const contract = (event.nft?.contract ?? GLYPHBOTS_CONTRACT).toLowerCase();
  const identity =
    event.transaction ??
    `nohash:${event.order_hash ?? ""}:${tokenId}:${event.quantity ?? ""}`;

  return [
    OPENSEA_CHAIN,
    contract,
    tokenId,
    effectiveEventType(event),
    identity,
    String(event.event_timestamp),
  ].join("|");
};

/**
 * The v2 API reports listings and offers as `event_type: "order"` with the
 * real type in `order_type` (`event-types.ts:15-24`). Collapse that here so
 * everything downstream sees one vocabulary.
 */
export const effectiveEventType = (event: OpenSeaEvent): string => {
  if (event.event_type === "order") {
    return event.order_type ?? "listing";
  }
  return event.event_type;
};

/**
 * Grouping key, ported from `event-grouping.ts:227-275`.
 *
 * The key is the actor, not the transaction: one buyer sweeping across three
 * separate transactions is still one sweep. Transfers, mints and burns are
 * dropped rather than keyed, because nothing in scope posts them and the mint
 * watcher already owns mints.
 */
export const actorKeyFor = (event: OpenSeaEvent): string | undefined => {
  const type = effectiveEventType(event);

  if (type === "sale") {
    const buyer = (event.buyer ?? "").toLowerCase();
    return buyer ? `purchase:${buyer}` : undefined;
  }

  if (type === "listing") {
    const maker = (event.maker ?? "").toLowerCase();
    return maker ? `listing:${maker}` : undefined;
  }

  return undefined;
};

export const isProcessed = (
  state: GroupingState,
  event: OpenSeaEvent
): boolean => state.processedKeys.includes(eventKeyFor(event));

/** Record an event as delivered. Bounded on write so storage cannot grow. */
export const markProcessed = (
  state: GroupingState,
  event: OpenSeaEvent
): void => {
  const key = eventKeyFor(event);
  if (state.processedKeys.includes(key)) {
    return;
  }
  state.processedKeys.push(key);
  if (state.processedKeys.length > SALES_PROCESSED_KEY_HISTORY) {
    state.processedKeys.splice(
      0,
      state.processedKeys.length - SALES_PROCESSED_KEY_HISTORY
    );
  }
};

export const markGroupProcessed = (
  state: GroupingState,
  events: OpenSeaEvent[]
): void => {
  for (const event of events) {
    markProcessed(state, event);
  }
};

/** `EventGroupManager.addEvents`, `event-grouping.ts:82-126`. */
export const addEvents = (
  state: GroupingState,
  events: OpenSeaEvent[],
  now: number
): void => {
  for (const event of events) {
    const key = actorKeyFor(event);
    if (!key) {
      continue;
    }

    let group = state.actorGroups[key];
    if (!group) {
      group = { events: [], lastAddedMs: 0, dedupeKeys: [], rawCount: 0 };
      state.actorGroups[key] = group;
    }

    group.rawCount += 1;

    const eventKey = eventKeyFor(event);
    if (group.dedupeKeys.includes(eventKey)) {
      // Deliberately does not refresh `lastAddedMs`. An event the API keeps
      // re-serving inside the lag window would otherwise push the settle
      // deadline out on every tick and the group would never flush.
      continue;
    }

    group.events.push(event);
    group.dedupeKeys.push(eventKey);
    group.lastAddedMs = now;
  }
};

/** `pruneStaleActorGroups`, `event-grouping.ts:353-360`. */
const pruneStaleGroups = (
  state: GroupingState,
  now: number,
  config: GroupConfig
): void => {
  const ttl = config.settleMs * SALES_GROUP_STALE_MULTIPLIER;
  for (const [key, group] of Object.entries(state.actorGroups)) {
    if (now - group.lastAddedMs >= ttl && group.rawCount < config.minGroupSize) {
      delete state.actorGroups[key];
    }
  }
};

/** `collectReadyActorGroups`, `event-grouping.ts:206-225`, predicate unchanged. */
export const collectReadyGroups = (
  state: GroupingState,
  now: number,
  config: GroupConfig = DEFAULT_GROUP_CONFIG
): { groups: ReadyGroup[]; releasedIndividuals: OpenSeaEvent[] } => {
  const groups: ReadyGroup[] = [];
  const releasedIndividuals: OpenSeaEvent[] = [];

  pruneStaleGroups(state, now, config);

  for (const [key, group] of Object.entries(state.actorGroups)) {
    const settled = now - group.lastAddedMs >= config.settleMs;
    const bigEnough = group.rawCount >= config.minGroupSize;

    if (!(settled && bigEnough)) {
      continue;
    }

    const unprocessed = group.events.filter(
      (event) => !isProcessed(state, event)
    );

    if (unprocessed.length >= config.minGroupSize) {
      groups.push({ tx: `actor:${key}`, events: unprocessed });
      log.info(`Flushing group ${key} with ${unprocessed.length} events`);
    } else if (unprocessed.length > 0) {
      // Below the minimum once the already-delivered members are removed, so
      // the survivors go out individually rather than as a group of one.
      log.info(
        `Releasing ${unprocessed.length} event(s) from group ${key} for individual posting`
      );
      releasedIndividuals.push(...unprocessed);
    }

    delete state.actorGroups[key];
  }

  return { groups, releasedIndividuals };
};

/**
 * Actor keys whose group is already big enough to flush, so their members must
 * not also go out individually. `getPendingLargeTxHashes`,
 * `event-grouping.ts:306-316`.
 */
const pendingLargeActorKeys = (
  state: GroupingState,
  config: GroupConfig
): Set<string> => {
  const keys = new Set<string>();
  for (const [key, group] of Object.entries(state.actorGroups)) {
    if (group.rawCount >= config.minGroupSize) {
      keys.add(key);
    }
  }
  return keys;
};

/** `filterProcessableEvents`, `event-grouping.ts:319-351`. */
export const filterProcessableEvents = (
  state: GroupingState,
  events: OpenSeaEvent[],
  config: GroupConfig = DEFAULT_GROUP_CONFIG
): {
  processableEvents: OpenSeaEvent[];
  skippedDupes: number;
  skippedPending: number;
} => {
  const pendingLarge = pendingLargeActorKeys(state, config);
  const processableEvents: OpenSeaEvent[] = [];
  let skippedDupes = 0;
  let skippedPending = 0;

  for (const event of events) {
    if (isProcessed(state, event)) {
      skippedDupes += 1;
      continue;
    }
    const key = actorKeyFor(event);
    if (key && pendingLarge.has(key)) {
      skippedPending += 1;
      continue;
    }
    processableEvents.push(event);
  }

  return { processableEvents, skippedDupes, skippedPending };
};

export type GroupingResult = {
  readyGroups: ReadyGroup[];
  processableEvents: OpenSeaEvent[];
  skippedDupes: number;
  skippedPending: number;
};

/**
 * One tick of the batcher, `processEventsWithAggregator`
 * (`event-grouping.ts:684-714`). Mutates `state` in place; the caller persists
 * it.
 *
 * Note the flush runs whether or not `events` is empty. That is the poll-driven
 * flush the Node bot got from calling its handlers with an empty array, and
 * dropping it would leave groups pending forever on a quiet collection.
 */
export const processEvents = (
  state: GroupingState,
  events: OpenSeaEvent[],
  now: number,
  config: GroupConfig = DEFAULT_GROUP_CONFIG
): GroupingResult => {
  if (events.length > 0) {
    addEvents(state, events, now);
  }

  const { groups: readyGroups, releasedIndividuals } = collectReadyGroups(
    state,
    now,
    config
  );

  const { processableEvents, skippedDupes, skippedPending } =
    events.length > 0
      ? filterProcessableEvents(state, events, config)
      : { processableEvents: [], skippedDupes: 0, skippedPending: 0 };

  return {
    readyGroups,
    processableEvents: [...processableEvents, ...releasedIndividuals],
    skippedDupes,
    skippedPending,
  };
};
