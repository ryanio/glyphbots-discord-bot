/**
 * An in-memory `IdleStateStore`, and the clocks the idle tests read from.
 *
 * The important detail is the JSON round trip on every read and write. The
 * production store is a `fetch` to a Durable Object, so anything that survives
 * only by object identity, a `Date`, a `Map`, a class instance, or a field the
 * DO's validator would reject, works perfectly in a test that hands the same
 * object back and fails in production. Serializing here is the same trick
 * `sales-fixtures.ts` uses, for the same reason.
 *
 * `apply` runs the real `applyIdleUpdate`, which is also what the DO runs, so
 * the merge semantics under test are the shipped ones rather than a
 * re-implementation.
 */

import { vi } from "vitest";
import { applyIdleUpdate, type IdleState, type IdleUpdate } from "../src/channels/idle";
import type { IdleStateStore } from "../src/durable-objects/idle-state-store";

const roundTrip = (state: IdleState | null): IdleState | null =>
  state === null ? null : (JSON.parse(JSON.stringify(state)) as IdleState);

export const idleState = (overrides: Partial<IdleState> = {}): IdleState => ({
  lastHumanMessageAtMs: null,
  lastNudgeAtMs: null,
  lastNudgeKind: null,
  lastGalleryAtMs: null,
  lastGalleryKind: null,
  ...overrides,
});

export type MemoryIdleStore = IdleStateStore & {
  readonly current: IdleState | null;
  readonly updates: IdleUpdate[];
};

export const createMemoryIdleStore = (
  initial: IdleState | null = null
): MemoryIdleStore => {
  let stored = roundTrip(initial);
  const updates: IdleUpdate[] = [];

  return {
    updates,
    get current() {
      return stored;
    },
    read: vi.fn(() => Promise.resolve(roundTrip(stored))),
    apply: vi.fn((update: IdleUpdate) => {
      // Through JSON on the way in as well: the update crosses the same wire.
      const wire = JSON.parse(JSON.stringify(update)) as IdleUpdate;
      updates.push(wire);
      stored = roundTrip(applyIdleUpdate(stored, wire));
      return Promise.resolve(stored as IdleState);
    }),
  };
};

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** A fixed "now" well clear of the epoch, so subtraction stays positive. */
export const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);
