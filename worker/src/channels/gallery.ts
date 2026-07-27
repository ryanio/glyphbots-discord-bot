/**
 * The `#gallery` cron: one random collection item, when the server is quiet.
 *
 * This is `RANDOM_INTERVALS` from `discord-nft-embed-bot/src/index.ts:696-746`
 * with the `setInterval` taken out. On the droplet the bot parsed
 * `CHANNEL_ID=minutes[:collections]`, resolved the channel, posted once on
 * startup if the interval had elapsed, then kept a timer alive forever. A
 * Worker has no process to hold a timer, so the schedule moves into
 * `wrangler.jsonc` (`0 *\/6 * * *`).
 *
 * ## Why the six-hourly post is now gated
 *
 * It used to post on every tick, which in a guild of about thirty people who
 * can go days without speaking meant the bot posting to itself four times a
 * day. That is the shape of a dead channel, not a lively one, and it made the
 * bot the loudest account in the server precisely when there was nobody to see
 * it.
 *
 * The rule: post only when `#general` has been quiet for 24 hours, and at most
 * once every 24 hours. Three consequences, all of them intended.
 *
 * - **An active server barely sees it.** Somebody having spoken yesterday is
 *   enough to suppress it entirely. That is the right default: `#gallery` is a
 *   filler channel, and filler is welcome only when there is nothing else.
 * - **A dead server sees one a day, not four.** The cron still fires every six
 *   hours, but three of those four ticks are inside the cooldown and cost one
 *   Durable Object read each.
 * - **It leads the nudge rather than duplicating it.** `#gallery` starts at 24
 *   hours of quiet and the `#general` nudge at 48, so a slowly quietening
 *   server gets the low-stakes post first, in the channel meant for it, and
 *   only sees anything in `#general` a day later. Once both are firing they are
 *   one post a day each, in different channels.
 *
 * The threshold is half the nudge's while the cadence is the same, so a quieter
 * server never makes the bot faster, only slightly earlier.
 *
 * `#general` is the signal for both because it is the only activity signal this
 * Worker has: the gateway sees `MESSAGE_CREATE` for `#general` and
 * `#show-and-tell`, and `#general` is where the guild actually talks. A room
 * that has been silent for a day is silent everywhere.
 *
 * What is kept from the Node bot: the collection rotation and the retry when a
 * random pick turns out not to exist (`MAX_NFT_FETCH_RETRIES` was three, and
 * that number carries over).
 *
 * What is dropped: the recently-posted token memory (`state.wasRecentlySent`,
 * ten attempts to find an unused id). It existed because a 30 minute interval
 * on a small collection repeats often. At one post a day across 11,111 bots a
 * repeat is not worth a Durable Object round trip.
 *
 * The rotation used to be derived from the wall clock. It is stored now, and
 * the reason is under `nextGalleryKind` in `./idle.ts`: gated to one post a
 * day, consecutive posts sit four six-hour buckets apart, which is the same
 * parity every time, so the clock-derived version would have posted bots and
 * only bots.
 */

import type { APIEmbed } from "discord-api-types/v10";
import { MAX_BOT_TOKEN_ID, RANDOM_ARTIFACT_FETCH_LIMIT } from "../config";
import type { ChannelPoster } from "../discord/channel-poster";
import type { IdleStateStore } from "../durable-objects/feed-stores";
import {
  buildArtifactLookupEmbed,
  buildBotLookupEmbed,
  type LookupClients,
} from "../lookups/embeds";
import { createLogger, getErrorMessage } from "../utils/logger";
import { randomInt as defaultRandomInt } from "../utils/random";
import { decideGallery, type GalleryKind, type IdleSkipReason } from "./idle";

const log = createLogger("Gallery");

/** `discord-nft-embed-bot/src/index.ts:64`. */
const MAX_ATTEMPTS = 3;

export type { GalleryKind };

export type GalleryDeps = {
  clients: LookupClients;
  poster: ChannelPoster;
  store: IdleStateStore;
  /** Injected in tests. */
  now?: () => number;
  randomInt?: (max: number) => number;
};

/** What one tick did. Only `send-failed` is a problem. */
export type GalleryOutcome =
  | "posted"
  | "seeded"
  | "no-content"
  | "send-failed"
  | IdleSkipReason;

const pickArtifactEmbed = async (
  deps: GalleryDeps
): Promise<APIEmbed | null> => {
  const recent = await deps.clients.glyphbots.fetchRecentArtifacts(
    RANDOM_ARTIFACT_FETCH_LIMIT
  );
  const minted = recent.filter((artifact) => artifact.contractTokenId !== null);

  if (minted.length === 0) {
    return null;
  }

  const randomInt = deps.randomInt ?? defaultRandomInt;
  const chosen = minted[randomInt(minted.length) - 1];

  if (!chosen?.contractTokenId) {
    return null;
  }

  return buildArtifactLookupEmbed(chosen.contractTokenId, deps.clients);
};

/**
 * One gallery tick.
 *
 * A tick that finds nothing is not an error: the bot id may be burned, the
 * artifact list may be empty. It logs and waits for the next check.
 */
export const postGalleryItem = async (
  deps: GalleryDeps
): Promise<GalleryOutcome> => {
  const now = deps.now?.() ?? Date.now();
  const state = await deps.store.read();

  if (state === null || state.lastHumanMessageAtMs === null) {
    await deps.store.apply({ op: "seed", atMs: now });
    log.info("Idle clock seeded on a cold start, #gallery posts nothing");
    return "seeded";
  }

  const decision = decideGallery(state, now);

  if (!decision.post) {
    log.debug(`Gallery check: ${decision.reason}`);
    return decision.reason;
  }

  const randomInt = deps.randomInt ?? defaultRandomInt;
  const { kind } = decision;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let embed: APIEmbed | null = null;

    try {
      embed =
        kind === "artifact"
          ? await pickArtifactEmbed(deps)
          : await buildBotLookupEmbed(
              randomInt(MAX_BOT_TOKEN_ID),
              deps.clients
            );
    } catch (error) {
      // Next attempt, not out of the loop. The retry exists because a random
      // pick can be a burned bot or an artifact the embed builders reject, and
      // returning here spent the whole three-attempt budget on the first bad
      // draw.
      log.error(
        `Gallery build ${attempt}/${MAX_ATTEMPTS} failed (${kind}): ${getErrorMessage(error)}`
      );
      continue;
    }

    if (!embed) {
      log.warn(
        `Gallery pick ${attempt}/${MAX_ATTEMPTS} found nothing (${kind})`
      );
      continue;
    }

    try {
      await deps.poster.send({ embeds: [embed] });
    } catch (error) {
      log.error(`Gallery post failed: ${getErrorMessage(error)}`);
      return "send-failed";
    }

    // Written only once Discord has accepted it, so a rejected post does not
    // buy the channel another day of silence.
    await deps.store.apply({ op: "gallery", atMs: now, kind });
    log.info(`Posted a random ${kind} to #gallery`);
    return "posted";
  }

  log.error(`Gallery gave up after ${MAX_ATTEMPTS} attempts (${kind})`);
  return "no-content";
};
