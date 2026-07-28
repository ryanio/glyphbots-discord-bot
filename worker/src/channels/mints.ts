/**
 * Mint watcher.
 *
 * The cursor logic came over from the Node bot unchanged in behavior. What
 * moved is where state lives (a Durable Object instead of a JSON file), how
 * messages are sent (REST instead of `channel.send`), and how the loop is
 * driven (a cron tick instead of `setInterval`).
 *
 * The cursor design, restated because it is easy to redo wrong:
 *
 * - `lastMintedAtMs` is the max `mintedAt` across every mint handled, parsed
 *   from the artifact's own data and never from `Date.now()`, so a slow poll
 *   or a redeploy cannot silently skip a window.
 * - Selection compares `>=`, inclusive, which deliberately re-admits anything
 *   sharing the boundary timestamp. `postedArtifactIds` (last 100) is what
 *   actually rejects duplicates, and it also covers API reordering and
 *   backfill.
 * - A failed send holds `lastMintedAtMs` back to at or below the oldest
 *   failure so that mint is selectable again next tick, while the successful
 *   ids stay in the set so they do not repost during that rewind.
 * - A cold start (cursor genuinely absent, not empty) seeds from the current
 *   newest mint and posts nothing, so reviving the bot never dumps the
 *   backlog. The first tick after deploy posting nothing is the expected
 *   result, not a failure.
 *
 * All of that arithmetic runs *inside* `FeedStateDO`. A poll reads the cursor,
 * spends a fetch and up to five Discord posts, and then sends an operation
 * describing what it handled and what failed; `applyMintCursorUpdate` does the
 * merge behind the input gate. Computing the next cursor out here instead would
 * put a read and a write on opposite sides of that gate with the entire post
 * loop in between. See `src/durable-objects/feed-stores.ts`.
 */

import { EmbedBuilder } from "@discordjs/builders";
import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import type { ResolvedName } from "../api/display-name";
import { addressOnly } from "../api/display-name";
import type { GlyphBotsClient } from "../api/glyphbots";
import { getOpenSeaArtifactUrl } from "../api/opensea";
import type { Artifact } from "../api/types";
import {
  GLYPHBOTS_COLOR,
  MINTS_FETCH_LIMIT,
  MINTS_MAX_POSTS_PER_POLL,
  MINTS_POST_DELAY_MS,
  MINTS_POSTED_ID_HISTORY,
} from "../config";
import type { ChannelPoster } from "../discord/channel-poster";
import { formatActor } from "../discord/embeds";
import type { MintCursorStore } from "../durable-objects/feed-stores";
import { createLogger, getErrorMessage } from "../utils/logger";
import { MS_PER_SECOND } from "../utils/time";

const log = createLogger("Mints");

/** An artifact known to be minted on chain. */
export type MintedArtifact = Artifact & {
  mintedAt: string;
  contractTokenId: number;
};

/**
 * The cursor record, stored in `FeedStateDO` under `mintCursor`.
 *
 * `null` from the store means genuinely absent (cold start, seed and post
 * nothing), which is a different thing from a cursor whose `lastMintedAtMs`
 * is null.
 */
export type MintsCursorState = {
  lastMintedAtMs: number | null;
  postedArtifactIds: string[];
};

export const EMPTY_MINT_CURSOR: MintsCursorState = {
  lastMintedAtMs: null,
  postedArtifactIds: [],
};

/**
 * The only two things the cursor arithmetic reads off an artifact.
 *
 * The update crosses the Durable Object boundary as JSON, and sending whole
 * artifacts would put several kilobytes of embed material on a hop that needs
 * an id and a timestamp.
 */
export type MintRecord = {
  id: string;
  mintedAtMs: number;
};

/** Every mutation the mint cursor accepts. Applied inside the DO. */
export type MintCursorUpdate =
  | { op: "seed"; handled: MintRecord[] }
  | { op: "advance"; handled: MintRecord[]; failed: MintRecord[] };

/** Everything one poll needs, injected so the logic stays testable. */
export type MintPollDeps = {
  api: Pick<
    GlyphBotsClient,
    "fetchRecentArtifacts" | "getArtifactUrl" | "getBotUrl"
  >;
  poster: ChannelPoster;
  store: MintCursorStore;
  /** Pause between individual posts. Overridden to a no-op under test. */
  delay?: (ms: number) => Promise<void>;
  /**
   * Minter address to a name, for the Minter field. Optional because this is
   * the one feed that otherwise touches no OpenSea endpoint at all, and a mint
   * post that falls back to the short address is not a degraded post. Supplied
   * from `src/index.ts`; see `../api/display-name.ts`.
   */
  resolveName?: (address: string) => Promise<ResolvedName>;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Narrow to artifacts that actually made it on chain. An artifact is only a
 * mint once it has both a mint time and a token id.
 */
export const isMinted = (artifact: Artifact): artifact is MintedArtifact =>
  artifact.mintedAt !== null &&
  artifact.mintedAt !== undefined &&
  artifact.contractTokenId !== null &&
  artifact.contractTokenId !== undefined;

/** Parse `mintedAt` into epoch milliseconds, or null if unparseable. */
export const mintedAtMs = (artifact: MintedArtifact): number | null => {
  const ms = new Date(artifact.mintedAt).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/** Sort oldest first so the channel reads chronologically. */
export const sortOldestFirst = (
  artifacts: MintedArtifact[]
): MintedArtifact[] =>
  [...artifacts].sort((a, b) => (mintedAtMs(a) ?? 0) - (mintedAtMs(b) ?? 0));

/**
 * Select the artifacts that are new relative to the cursor.
 *
 * The timestamp comparison is inclusive on the low end so mints sharing a
 * `mintedAt` with the cursor are still considered; the posted id set is what
 * actually rejects the ones already sent.
 */
export const selectNewMints = (
  artifacts: Artifact[],
  cursor: MintsCursorState
): MintedArtifact[] => {
  const posted = new Set(cursor.postedArtifactIds);
  const since = cursor.lastMintedAtMs;

  const candidates = artifacts.filter((artifact) => {
    if (!isMinted(artifact)) {
      return false;
    }
    if (posted.has(artifact.id)) {
      return false;
    }
    const ms = mintedAtMs(artifact);
    if (ms === null) {
      return false;
    }
    return since === null || ms >= since;
  }) as MintedArtifact[];

  return sortOldestFirst(candidates);
};

/**
 * Build the cursor to persist after handling a batch.
 *
 * Only handled artifacts get their ids recorded, so anything that failed to
 * send is eligible again next poll. The timestamp advances past everything
 * handled, then is clamped to sit at or below the oldest failure, since a mint
 * that never reached Discord must stay selectable. Successes newer than that
 * clamp are protected from a repost by their ids being in the set.
 */
export const advanceCursor = (
  cursor: MintsCursorState,
  handled: readonly MintRecord[],
  failed: readonly MintRecord[] = []
): MintsCursorState => {
  let lastMintedAtMs = cursor.lastMintedAtMs;
  const postedArtifactIds = [...cursor.postedArtifactIds];

  for (const record of handled) {
    if (lastMintedAtMs === null || record.mintedAtMs > lastMintedAtMs) {
      lastMintedAtMs = record.mintedAtMs;
    }
    if (!postedArtifactIds.includes(record.id)) {
      postedArtifactIds.push(record.id);
    }
  }

  for (const record of failed) {
    if (lastMintedAtMs !== null && record.mintedAtMs < lastMintedAtMs) {
      lastMintedAtMs = record.mintedAtMs;
    }
  }

  return {
    lastMintedAtMs,
    postedArtifactIds: postedArtifactIds.slice(-MINTS_POSTED_ID_HISTORY),
  };
};

/**
 * Narrow artifacts to what the cursor needs, dropping any whose `mintedAt` is
 * not a date.
 *
 * Dropping rather than carrying a null costs nothing: `selectNewMints` already
 * refuses an artifact it cannot parse a timestamp from, so one can never reach
 * a post, and recording its id would only take a slot in a bounded set.
 */
export const toMintRecords = (
  artifacts: readonly MintedArtifact[]
): MintRecord[] =>
  artifacts.flatMap((artifact) => {
    const ms = mintedAtMs(artifact);
    return ms === null ? [] : [{ id: artifact.id, mintedAtMs: ms }];
  });

/**
 * Apply one operation to the cursor. Pure, and run inside the DO.
 *
 * `seed` never overwrites a cursor that already exists. Two ticks that both
 * read `null` would otherwise both seed, and the second would reset the first
 * one's position; the same rule `applyIdleUpdate` uses, for the same reason.
 */
export const applyMintCursorUpdate = (
  current: MintsCursorState | null,
  update: MintCursorUpdate
): MintsCursorState => {
  switch (update.op) {
    case "seed":
      return current ?? advanceCursor(EMPTY_MINT_CURSOR, update.handled);
    case "advance":
      return advanceCursor(
        current ?? EMPTY_MINT_CURSOR,
        update.handled,
        update.failed
      );
  }
};

/**
 * Build the embed for a single minted artifact.
 *
 * `minter` arrives already resolved rather than being looked up in here, which
 * keeps this function synchronous and pure: the caller owns the one network
 * call and the caching that goes with it. Omitted, the Minter field falls back
 * to the shortened address it has always shown.
 */
export const buildMintEmbed = (
  artifact: MintedArtifact,
  api: Pick<MintPollDeps["api"], "getArtifactUrl" | "getBotUrl">,
  minter: ResolvedName | null = null
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(GLYPHBOTS_COLOR)
    .setTitle(`◈ ${artifact.title ?? "Artifact"} #${artifact.contractTokenId}`)
    .setURL(api.getArtifactUrl(artifact.contractTokenId));

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  // The marketplace link leads. It replaces the mint transaction on Etherscan,
  // which was the last field and the least interesting thing about a new
  // artifact: a hash nobody clicks, in a block explorer that shows none of the
  // art. Every minted artifact has a token id by construction, so unlike the tx
  // hash this link is always there.
  fields.push({
    name: "◈ OpenSea",
    value: `[View](${getOpenSeaArtifactUrl(artifact.contractTokenId)})`,
    inline: true,
  });

  fields.push({
    name: "◈ Bot",
    value: `[#${artifact.botTokenId}](${api.getBotUrl(artifact.botTokenId)})`,
    inline: true,
  });

  if (artifact.minter) {
    fields.push({
      name: "◈ Minter",
      value: formatActor(minter ?? addressOnly(artifact.minter)),
      inline: true,
    });
  }

  if (artifact.mintQuantity && artifact.mintQuantity > 1) {
    fields.push({
      name: "◈ Quantity",
      value: `×${artifact.mintQuantity}`,
      inline: true,
    });
  }

  if (artifact.type) {
    fields.push({ name: "◈ Type", value: artifact.type, inline: true });
  }

  const mintedSeconds = Math.floor(
    new Date(artifact.mintedAt).getTime() / MS_PER_SECOND
  );
  fields.push({
    name: "◉ Minted",
    value: `<t:${mintedSeconds}:R>`,
    inline: true,
  });

  embed.addFields(fields);

  return embed;
};

/**
 * Post one mint. Returns false on any failure, including a failure to build.
 *
 * The build is inside the try on purpose. `EmbedBuilder` validates through
 * `@sapphire/shapeshift` at call time, so `setURL`, `setImage`, `setTitle` and
 * `addFields` throw synchronously on a relative `imageUrl`, a title over 256
 * characters or a field value over 1024, and every one of those inputs is
 * third-party data off the GlyphBots API. Built outside the try, one bad
 * artifact threw all the way out of `pollMints`, the cursor write never ran,
 * and five minutes later the whole batch was selected again: the good mints
 * before it reposted, forever. Same per-item shape as
 * `src/lookups/handle.ts:110-122`.
 */
const postMint = async (
  deps: MintPollDeps,
  artifact: MintedArtifact
): Promise<boolean> => {
  try {
    // Inside the try with the build, and for the same reason: this is the one
    // network call on the post path that is not the post itself, and a name
    // lookup must never be what stops a mint from being announced. The resolver
    // swallows its own failures, so this only guards a missing implementation.
    const minter =
      artifact.minter && deps.resolveName
        ? await deps.resolveName(artifact.minter)
        : null;

    const body: RESTPostAPIChannelMessageJSONBody = {
      embeds: [buildMintEmbed(artifact, deps.api, minter).toJSON()],
    };

    await deps.poster.send(body);
    log.info(
      `Posted mint: ${artifact.title ?? "Artifact"} #${artifact.contractTokenId} (bot ${artifact.botTokenId})`
    );
    return true;
  } catch (error) {
    log.error(
      `Failed to post mint ${artifact.id} (#${artifact.contractTokenId}): ${getErrorMessage(error)}`
    );
    return false;
  }
};

/**
 * Post one summary line for mints the burst guard skipped. Returns false when
 * the line did not reach Discord, because the caller uses that to decide
 * whether the summarized mints count as handled.
 */
const postBurstSummary = async (
  deps: MintPollDeps,
  skipped: MintedArtifact[]
): Promise<boolean> => {
  if (skipped.length === 0) {
    return true;
  }

  const plural = skipped.length === 1 ? "artifact" : "artifacts";

  try {
    await deps.poster.send({
      content: `◈ …and **${skipped.length}** more ${plural} minted in this batch.`,
    });
    return true;
  } catch (error) {
    log.error(`Failed to send burst summary: ${getErrorMessage(error)}`);
    return false;
  }
};

/** Seed the cursor on a cold start without posting the backlog. */
const seedCursor = async (
  deps: MintPollDeps,
  minted: MintedArtifact[]
): Promise<void> => {
  const seeded = await deps.store.apply({
    op: "seed",
    handled: toMintRecords(minted),
  });

  const at = seeded.lastMintedAtMs
    ? new Date(seeded.lastMintedAtMs).toISOString()
    : "empty";
  log.info(
    `Seeded mint cursor at ${at}, skipped ${minted.length} historical mint${
      minted.length === 1 ? "" : "s"
    } (no backlog posted)`
  );
};

/**
 * Run one poll: fetch, diff against the cursor, post, advance the cursor.
 * Returns the number of mints posted individually.
 */
export const pollMints = async (deps: MintPollDeps): Promise<number> => {
  const delay = deps.delay ?? sleep;
  const artifacts = await deps.api.fetchRecentArtifacts(MINTS_FETCH_LIMIT);

  if (artifacts.length === 0) {
    log.debug("No artifacts returned by the API");
    return 0;
  }

  const cursor = await deps.store.read();

  if (!cursor) {
    await seedCursor(deps, sortOldestFirst(artifacts.filter(isMinted)));
    return 0;
  }

  const newMints = selectNewMints(artifacts, cursor);

  if (newMints.length === 0) {
    log.debug("No new mints this poll");
    return 0;
  }

  log.info(`Detected ${newMints.length} new mint(s)`);

  // Burst guard: post the newest few individually, summarize the remainder.
  const overflowing = newMints.length > MINTS_MAX_POSTS_PER_POLL;
  const toPost = overflowing
    ? newMints.slice(-MINTS_MAX_POSTS_PER_POLL)
    : newMints;
  const skipped = overflowing
    ? newMints.slice(0, newMints.length - MINTS_MAX_POSTS_PER_POLL)
    : [];

  let summarized = true;
  if (skipped.length > 0) {
    log.warn(
      `Burst guard: posting ${toPost.length} of ${newMints.length} mints individually, summarizing ${skipped.length}`
    );
    summarized = await postBurstSummary(deps, skipped);
  }

  const posted: MintedArtifact[] = [];
  const failed: MintedArtifact[] = [];

  for (const [index, artifact] of toPost.entries()) {
    if (index > 0) {
      await delay(MINTS_POST_DELAY_MS);
    }
    if (await postMint(deps, artifact)) {
      posted.push(artifact);
    } else {
      failed.push(artifact);
    }
  }

  // The summarized mints only count as handled once the summary line actually
  // reached Discord. Treating them as handled regardless is how a single failed
  // summary send loses a whole burst: their ids go into the posted set and the
  // timestamp advances past them, and nothing ever mentions them again. A
  // failed summary puts them in `failed` instead, which clamps the timestamp to
  // at or below the oldest of them, exactly as a failed individual send does,
  // so the next poll picks them up again.
  const handled = summarized ? [...skipped, ...posted] : posted;
  if (!summarized) {
    failed.push(...skipped);
  }

  // Advance past everything handled, including the summarized ones, so a burst
  // is never replayed. A mint whose send failed is deliberately left behind the
  // timestamp so the next poll retries it; the posted id set is what keeps the
  // already-sent mints from being posted twice when that rewind happens.
  // The merge happens inside the DO. Everything above this line is a network
  // call and a Discord post, so a read here and a whole-value write there would
  // be a read-modify-write with seconds and two hops in the middle: a tick that
  // overlapped this one would have its ids silently dropped. Sending what
  // changed keeps the read and the write on the same side of the input gate.
  await deps.store.apply({
    op: "advance",
    handled: toMintRecords(handled),
    failed: toMintRecords(failed),
  });

  if (failed.length > 0) {
    log.warn(
      `${failed.length} mint(s) failed to send, cursor held back for retry next poll`
    );
  }

  return posted.length;
};
