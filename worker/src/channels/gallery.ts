/**
 * The `#gallery` cron: one random collection item, every six hours.
 *
 * This is `RANDOM_INTERVALS` from `discord-nft-embed-bot/src/index.ts:696-746`
 * with the `setInterval` taken out. On the droplet the bot parsed
 * `CHANNEL_ID=minutes[:collections]`, resolved the channel, posted once on
 * startup if the interval had elapsed, then kept a timer alive forever. A
 * Worker has no process to hold a timer, so the schedule moves into
 * `wrangler.jsonc` (`0 *\/6 * * *`) and the state that made the timer
 * resumable is not needed.
 *
 * What is kept: the collection rotation (bots, then artifacts, then bots) and
 * the retry when a random pick turns out not to exist. The Node bot retried
 * three times (`MAX_NFT_FETCH_RETRIES`) and that number carries over.
 *
 * What is dropped: the recently-posted token memory
 * (`state.wasRecentlySent`, ten attempts to find an unused id). It existed
 * because a 30 minute interval on a small collection repeats often. At six
 * hours across 11,111 bots the chance of a repeat inside a month is small
 * enough that a Durable Object round trip per post is not worth it. If repeats
 * ever become visible, the place to fix it is a `galleryRecent` key in
 * `FeedStateDO`, not here.
 *
 * The rotation index is derived from the wall clock rather than stored, so two
 * isolates cannot disagree about whose turn it is: six hour buckets since the
 * epoch, alternating. A missed tick shifts the pattern and nothing else.
 */

import type { APIEmbed } from "discord-api-types/v10";
import { MAX_BOT_TOKEN_ID } from "../config";
import type { ChannelPoster } from "../discord/channel-poster";
import {
  buildArtifactLookupEmbed,
  buildBotLookupEmbed,
  type LookupClients,
} from "../lookups/embeds";
import { createLogger, getErrorMessage } from "../utils/logger";

const log = createLogger("Gallery");

/** `discord-nft-embed-bot/src/index.ts:64`. */
const MAX_ATTEMPTS = 3;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const RECENT_ARTIFACT_LIMIT = 50;

export type GalleryKind = "bot" | "artifact";

export type GalleryDeps = {
  clients: LookupClients;
  poster: ChannelPoster;
  /** Injected in tests. */
  now?: () => number;
  randomInt?: (max: number) => number;
};

/**
 * Whose turn it is. Even six-hour buckets are bots, odd are artifacts, so the
 * channel alternates without anything being written down.
 */
export const galleryKindFor = (now: number): GalleryKind =>
  Math.floor(now / SIX_HOURS_MS) % 2 === 0 ? "bot" : "artifact";

const pickArtifactEmbed = async (
  deps: GalleryDeps
): Promise<APIEmbed | null> => {
  const recent = await deps.clients.glyphbots.fetchRecentArtifacts(
    RECENT_ARTIFACT_LIMIT
  );
  const minted = recent.filter((artifact) => artifact.contractTokenId !== null);

  if (minted.length === 0) {
    return null;
  }

  const randomInt = deps.randomInt ?? ((max: number) => Math.floor(Math.random() * max) + 1);
  const chosen = minted[randomInt(minted.length) - 1];

  if (!chosen?.contractTokenId) {
    return null;
  }

  return buildArtifactLookupEmbed(chosen.contractTokenId, deps.clients);
};

/**
 * One gallery tick. Returns true when something was posted.
 *
 * A tick that finds nothing is not an error: the bot id may be burned, the
 * artifact list may be empty. It logs and waits six hours.
 */
export const postGalleryItem = async (deps: GalleryDeps): Promise<boolean> => {
  const now = deps.now?.() ?? Date.now();
  const randomInt =
    deps.randomInt ?? ((max: number) => Math.floor(Math.random() * max) + 1);
  const kind = galleryKindFor(now);

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
      log.error(`Gallery build failed: ${getErrorMessage(error)}`);
      return false;
    }

    if (!embed) {
      log.warn(`Gallery pick ${attempt}/${MAX_ATTEMPTS} found nothing (${kind})`);
      continue;
    }

    try {
      await deps.poster.send({ embeds: [embed] });
      log.info(`Posted a random ${kind} to #gallery`);
      return true;
    } catch (error) {
      log.error(`Gallery post failed: ${getErrorMessage(error)}`);
      return false;
    }
  }

  log.error(`Gallery gave up after ${MAX_ATTEMPTS} attempts (${kind})`);
  return false;
};
