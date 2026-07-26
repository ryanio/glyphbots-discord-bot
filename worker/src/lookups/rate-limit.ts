/**
 * Per-channel rate limiting for inline lookups.
 *
 * The Node bot had none. Verified: no cooldown, no debounce, no queue anywhere
 * in `discord-nft-embed-bot`. On a droplet that only cost patience; on Workers
 * each answered lookup is several sequential OpenSea calls against a
 * per-invocation subrequest budget, so an unthrottled channel is the one way
 * this feature can take the whole Worker down with it.
 *
 * The shape is Coral's (`discord-gateway.ts:1752-1763`): an in-memory fixed
 * window per channel, holding timestamps and filtering them on read. Two
 * additions over Coral:
 *
 * - a minimum gap between answers, so a burst cannot spend the whole window at
 *   once (a pasted list of ids is exactly that burst),
 * - `now` is injected, so the tests are not clock-dependent.
 *
 * State is in memory and resets when the DO is evicted. That is deliberate and
 * matches Coral: this is a spend guard, not a security control, and persisting
 * it would put a storage write on the hot path of every message.
 */

import {
  LOOKUP_COOLDOWN_MS,
  LOOKUP_RATE_LIMIT_MAX,
  LOOKUP_RATE_LIMIT_WINDOW_MS,
} from "../config";

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "cooldown" | "window" };

export type RateLimiter = {
  /** Records the hit when it allows one. Call it once per candidate message. */
  check: (channelId: string, now?: number) => RateLimitDecision;
};

export type RateLimiterOptions = {
  cooldownMs?: number;
  max?: number;
  windowMs?: number;
};

export const createRateLimiter = (
  options: RateLimiterOptions = {}
): RateLimiter => {
  const windowMs = options.windowMs ?? LOOKUP_RATE_LIMIT_WINDOW_MS;
  const max = options.max ?? LOOKUP_RATE_LIMIT_MAX;
  const cooldownMs = options.cooldownMs ?? LOOKUP_COOLDOWN_MS;

  const hits = new Map<string, number[]>();

  return {
    check: (channelId, now = Date.now()) => {
      const previous = hits.get(channelId) ?? [];
      const fresh = previous.filter((at) => now - at < windowMs);

      const last = fresh.at(-1);
      if (last !== undefined && now - last < cooldownMs) {
        hits.set(channelId, fresh);
        return { allowed: false, reason: "cooldown" };
      }

      if (fresh.length >= max) {
        hits.set(channelId, fresh);
        return { allowed: false, reason: "window" };
      }

      fresh.push(now);
      hits.set(channelId, fresh);
      return { allowed: true };
    },
  };
};
