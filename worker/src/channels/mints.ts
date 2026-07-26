/**
 * Mint watcher.
 *
 * Ported from `src/channels/mints.ts`. The cursor logic is unchanged in
 * behavior; what moved is where state lives (Durable Object instead of a JSON
 * file), how messages are sent (REST instead of `channel.send`), and how the
 * loop is driven (a cron tick instead of `setInterval`).
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
 */

import { EmbedBuilder } from "@discordjs/builders";
import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import type { GlyphBotsClient } from "../api/glyphbots";
import { shortAddress } from "../api/glyphbots";
import type { Artifact } from "../api/types";
import {
  ETHERSCAN_TX_URL,
  GLYPHBOTS_COLOR,
  MINTS_FETCH_LIMIT,
  MINTS_MAX_POSTS_PER_POLL,
  MINTS_POST_DELAY_MS,
  MINTS_POSTED_ID_HISTORY,
} from "../config";
import type { ChannelPoster } from "../discord/channel-poster";
import type { MintsCursorState } from "../durable-objects/feed-state";
import type { MintCursorStore } from "../durable-objects/mint-cursor-store";
import { createLogger, getErrorMessage } from "../utils/logger";

const log = createLogger("Mints");

const MS_PER_SECOND = 1000;

/** An artifact known to be minted on chain. */
export type MintedArtifact = Artifact & {
  mintedAt: string;
  contractTokenId: number;
};

/** Everything one poll needs, injected so the logic stays testable. */
export type MintPollDeps = {
  api: Pick<GlyphBotsClient, "fetchRecentArtifacts" | "getArtifactUrl" | "getBotUrl">;
  poster: ChannelPoster;
  store: MintCursorStore;
  /** Pause between individual posts. Overridden to a no-op under test. */
  delay?: (ms: number) => Promise<void>;
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
  handled: MintedArtifact[],
  failed: MintedArtifact[] = []
): MintsCursorState => {
  let lastMintedAtMs = cursor.lastMintedAtMs;
  const postedArtifactIds = [...cursor.postedArtifactIds];

  for (const artifact of handled) {
    const ms = mintedAtMs(artifact);
    if (ms !== null && (lastMintedAtMs === null || ms > lastMintedAtMs)) {
      lastMintedAtMs = ms;
    }
    if (!postedArtifactIds.includes(artifact.id)) {
      postedArtifactIds.push(artifact.id);
    }
  }

  for (const artifact of failed) {
    const ms = mintedAtMs(artifact);
    if (ms !== null && lastMintedAtMs !== null && ms < lastMintedAtMs) {
      lastMintedAtMs = ms;
    }
  }

  return {
    lastMintedAtMs,
    postedArtifactIds: postedArtifactIds.slice(-MINTS_POSTED_ID_HISTORY),
  };
};

/** Build the embed for a single minted artifact. */
export const buildMintEmbed = (
  artifact: MintedArtifact,
  api: Pick<MintPollDeps["api"], "getArtifactUrl" | "getBotUrl">
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(GLYPHBOTS_COLOR)
    .setTitle(`◈ ${artifact.title} #${artifact.contractTokenId}`)
    .setURL(api.getArtifactUrl(artifact.contractTokenId));

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  fields.push({
    name: "◈ Bot",
    value: `[#${artifact.botTokenId}](${api.getBotUrl(artifact.botTokenId)})`,
    inline: true,
  });

  if (artifact.minter) {
    fields.push({
      name: "◈ Minter",
      value: shortAddress(artifact.minter),
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

  if (artifact.mintTxHash) {
    fields.push({
      name: "◉ Transaction",
      value: `[Etherscan](${ETHERSCAN_TX_URL}${artifact.mintTxHash})`,
      inline: true,
    });
  }

  embed.addFields(fields);

  return embed;
};

/** Post one mint. Returns false on any send failure. */
const postMint = async (
  deps: MintPollDeps,
  artifact: MintedArtifact
): Promise<boolean> => {
  const body: RESTPostAPIChannelMessageJSONBody = {
    embeds: [buildMintEmbed(artifact, deps.api).toJSON()],
  };

  try {
    await deps.poster.send(body);
    log.info(
      `Posted mint: ${artifact.title} #${artifact.contractTokenId} (bot ${artifact.botTokenId})`
    );
    return true;
  } catch (error) {
    log.error(`Failed to send mint message: ${getErrorMessage(error)}`);
    return false;
  }
};

/** Post one summary line for mints the burst guard skipped. */
const postBurstSummary = async (
  deps: MintPollDeps,
  skipped: MintedArtifact[]
): Promise<void> => {
  if (skipped.length === 0) {
    return;
  }

  const plural = skipped.length === 1 ? "artifact" : "artifacts";

  try {
    await deps.poster.send({
      content: `◈ …and **${skipped.length}** more ${plural} minted in this batch.`,
    });
  } catch (error) {
    log.error(`Failed to send burst summary: ${getErrorMessage(error)}`);
  }
};

/** Seed the cursor on a cold start without posting the backlog. */
const seedCursor = async (
  deps: MintPollDeps,
  minted: MintedArtifact[]
): Promise<void> => {
  const seeded = advanceCursor(
    { lastMintedAtMs: null, postedArtifactIds: [] },
    minted
  );

  await deps.store.write(seeded);

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

  if (skipped.length > 0) {
    log.warn(
      `Burst guard: posting ${toPost.length} of ${newMints.length} mints individually, summarizing ${skipped.length}`
    );
    await postBurstSummary(deps, skipped);
  }

  const handled: MintedArtifact[] = [...skipped];
  const failed: MintedArtifact[] = [];

  for (const [index, artifact] of toPost.entries()) {
    if (index > 0) {
      await delay(MINTS_POST_DELAY_MS);
    }
    if (await postMint(deps, artifact)) {
      handled.push(artifact);
    } else {
      failed.push(artifact);
    }
  }

  // Advance past everything handled, including the summarized ones, so a burst
  // is never replayed. A mint whose send failed is deliberately left behind the
  // timestamp so the next poll retries it; the posted id set is what keeps the
  // already-sent mints from being posted twice when that rewind happens.
  await deps.store.write(advanceCursor(cursor, handled, failed));

  if (failed.length > 0) {
    log.warn(
      `${failed.length} mint(s) failed to send, cursor held back for retry next poll`
    );
  }

  return handled.length - skipped.length;
};
