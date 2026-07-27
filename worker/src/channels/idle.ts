/**
 * The idle clock: when the guild last said something, and what the bot has
 * said about it since.
 *
 * One record, shared by two callers. `src/channels/nudge.ts` reads it to decide
 * whether 48 hours of silence have accumulated, and `src/channels/gallery.ts`
 * reads it to decide whether its own post is welcome. Everything here is pure,
 * so the whole decision can be tested without a Durable Object, a clock or a
 * network.
 *
 * ## Why the clock is written down rather than kept in memory
 *
 * The obvious home for "when did a human last post" is a field on `GatewayDO`,
 * which is the thing already receiving `MESSAGE_CREATE`. That is wrong in both
 * directions, and both failures are silent:
 *
 * - a fresh DO after a deploy has no timestamp. Read as "nothing since the
 *   epoch", the very first tick sees infinite silence and fires; read as "now",
 *   a nudge that was genuinely due is suppressed for another two days.
 * - the DO is also evicted on relocation, not only on deploy, so the reset is
 *   not something a deploy schedule can reason about.
 *
 * So it lives in `FeedStateDO` alongside the mint cursor and the sales state,
 * under its own key. The cold start is then explicit rather than accidental:
 * an absent record seeds `lastHumanMessageAtMs` to the current time and posts
 * nothing, exactly like the mint watcher's first tick.
 *
 * ## Why the updates are operations rather than whole-record writes
 *
 * Two writers touch this record: the gateway, on every human message, and the
 * hourly cron. A read-modify-write split across the two would let the cron's
 * write clobber a message that landed while it was building an embed, which is
 * the one bug that would make the bot talk over somebody. `applyIdleUpdate` is
 * applied *inside* the DO, so the read and the write sit on the same side of
 * the input gate, and each operation only touches its own fields.
 */

import {
  GALLERY_COOLDOWN_MS,
  GALLERY_QUIET_THRESHOLD_MS,
  GUILD_ID,
  IDLE_QUIET_THRESHOLD_MS,
  NUDGE_CHANNEL_ID,
  NUDGE_COOLDOWN_MS,
} from "../config";
import type { LookupMessage } from "../lookups/handle";

/**
 * The four things a nudge can be, in rotation order.
 *
 * Order is the rotation: `nextNudgeKind` steps one along and wraps, so the
 * same kind can never land twice in a row.
 */
export const NUDGE_KINDS = ["bot", "artifact", "stat", "notable"] as const;

export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** What `#gallery` alternates between. Lives here because the record holds it. */
export const GALLERY_KINDS = ["bot", "artifact"] as const;

export type GalleryKind = (typeof GALLERY_KINDS)[number];

/**
 * The whole record.
 *
 * `null` in any field means "has never happened", which is a different thing
 * from zero and is the only reason cold start can be told apart from a very
 * long silence.
 */
export type IdleState = {
  /** Last non-bot message seen in `#general`, epoch ms. */
  lastHumanMessageAtMs: number | null;
  lastNudgeAtMs: number | null;
  lastNudgeKind: NudgeKind | null;
  lastGalleryAtMs: number | null;
  lastGalleryKind: GalleryKind | null;
};

export const EMPTY_IDLE_STATE: IdleState = {
  lastHumanMessageAtMs: null,
  lastNudgeAtMs: null,
  lastNudgeKind: null,
  lastGalleryAtMs: null,
  lastGalleryKind: null,
};

/** Every mutation anything is allowed to make to the record. */
export type IdleUpdate =
  | { op: "seed"; atMs: number }
  | { op: "human-message"; atMs: number }
  | { op: "nudge"; atMs: number; kind: NudgeKind }
  | { op: "gallery"; atMs: number; kind: GalleryKind };

/**
 * Apply one operation. Pure, and run inside the DO so it is atomic.
 *
 * Two details are deliberate. `seed` never overwrites a clock that already
 * exists, so a cron seeding at the same moment a message arrives cannot erase
 * the message. `human-message` takes the maximum rather than the argument, so
 * an event delivered out of order cannot wind the clock backwards and
 * manufacture silence.
 */
export const applyIdleUpdate = (
  current: IdleState | null,
  update: IdleUpdate
): IdleState => {
  const base = current ?? EMPTY_IDLE_STATE;

  switch (update.op) {
    case "seed":
      return base.lastHumanMessageAtMs === null
        ? { ...base, lastHumanMessageAtMs: update.atMs }
        : base;
    case "human-message":
      return {
        ...base,
        lastHumanMessageAtMs: Math.max(
          base.lastHumanMessageAtMs ?? 0,
          update.atMs
        ),
      };
    case "nudge":
      return { ...base, lastNudgeAtMs: update.atMs, lastNudgeKind: update.kind };
    case "gallery":
      return {
        ...base,
        lastGalleryAtMs: update.atMs,
        lastGalleryKind: update.kind,
      };
  }
};

/**
 * Does this message count as the server being alive?
 *
 * The bot check is the one that matters. Our own nudge lands in `#general` as
 * a `MESSAGE_CREATE` like any other, and a clock that accepted it would be
 * reset by the very post it was measuring: the bot would nudge once, restart
 * its own 48 hours, and never fire again. Both the `bot` flag and an id match
 * against ourselves are checked, because a message from this application
 * arrives with `bot: true` anyway and the id check costs nothing.
 *
 * Channel and guild are checked too. Silence is measured in `#general`
 * specifically, so chatter in `#trading-floor` does not count and neither does
 * anything from another guild the token might be in.
 */
export const isHumanActivity = (
  message: LookupMessage,
  selfUserId: string | null | undefined
): boolean =>
  message.author.bot !== true &&
  message.author.id !== selfUserId &&
  message.guild_id === GUILD_ID &&
  message.channel_id === NUDGE_CHANNEL_ID;

/** One step along the rotation, wrapping. `null` starts at the beginning. */
export const nextNudgeKind = (previous: NudgeKind | null): NudgeKind => {
  const index = previous === null ? -1 : NUDGE_KINDS.indexOf(previous);
  return NUDGE_KINDS[(index + 1) % NUDGE_KINDS.length] as NudgeKind;
};

/**
 * `#gallery` alternates the same way.
 *
 * This used to be derived from the wall clock (six hour buckets since the
 * epoch, alternating). That worked while the cron posted on every tick and
 * breaks the moment it does not: gated to one post a day, consecutive posts sit
 * four six-hour buckets apart, which is the same parity every time, so the
 * channel would only ever see bots. Rotation from the stored value is right
 * whatever the cadence.
 */
export const nextGalleryKind = (previous: GalleryKind | null): GalleryKind =>
  previous === "bot" ? "artifact" : "bot";

/** Why a tick decided to stay quiet. */
export type IdleSkipReason = "no-clock" | "not-quiet" | "cooling-down";

export type IdleDecision<Kind> =
  | { post: true; kind: Kind }
  | { post: false; reason: IdleSkipReason };

/**
 * How long the guild has been silent, or `null` when the clock has never been
 * set (cold start).
 */
export const quietForMs = (state: IdleState, now: number): number | null =>
  state.lastHumanMessageAtMs === null
    ? null
    : Math.max(0, now - state.lastHumanMessageAtMs);

/**
 * The nudge decision, in one place.
 *
 * The threshold and the cooldown do different jobs and both are needed. The
 * threshold is measured against the last human message, so any message at all
 * pushes the next possible nudge a full 48 hours out. The cooldown is measured
 * against the last nudge, so once the silence is long enough the bot posts on
 * a 24 hour rhythm instead of every time the cron notices the silence is still
 * there. Neither one alone gives that: threshold-only would post hourly
 * forever, cooldown-only would post daily into a busy channel.
 */
export const decideNudge = (
  state: IdleState,
  now: number
): IdleDecision<NudgeKind> => {
  const quiet = quietForMs(state, now);

  if (quiet === null) {
    return { post: false, reason: "no-clock" };
  }
  if (quiet < IDLE_QUIET_THRESHOLD_MS) {
    return { post: false, reason: "not-quiet" };
  }
  if (
    state.lastNudgeAtMs !== null &&
    now - state.lastNudgeAtMs < NUDGE_COOLDOWN_MS
  ) {
    return { post: false, reason: "cooling-down" };
  }

  return { post: true, kind: nextNudgeKind(state.lastNudgeKind) };
};

/** The same shape for `#gallery`, against its own two numbers. */
export const decideGallery = (
  state: IdleState,
  now: number
): IdleDecision<GalleryKind> => {
  const quiet = quietForMs(state, now);

  if (quiet === null) {
    return { post: false, reason: "no-clock" };
  }
  if (quiet < GALLERY_QUIET_THRESHOLD_MS) {
    return { post: false, reason: "not-quiet" };
  }
  if (
    state.lastGalleryAtMs !== null &&
    now - state.lastGalleryAtMs < GALLERY_COOLDOWN_MS
  ) {
    return { post: false, reason: "cooling-down" };
  }

  return { post: true, kind: nextGalleryKind(state.lastGalleryKind) };
};
