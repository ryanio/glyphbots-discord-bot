/**
 * Mints Channel
 *
 * Polls the GlyphBots API for newly minted artifacts and posts each one to a
 * Discord channel, oldest first, so the channel reads chronologically.
 */

import {
  type Client,
  EmbedBuilder,
  type HexColorString,
  type TextBasedChannel,
} from "discord.js";
import {
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../api/glyphbots";
import { shortAddress } from "../api/opensea";
import {
  MINTS_MAX_POSTS_PER_POLL,
  MINTS_POLL_INTERVAL_MINUTES,
  MINTS_POST_DELAY_MS,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from "../lib/constants";
import {
  getChannelDisplayName,
  resolveTextChannel,
} from "../lib/discord/channels";
import { prefixedLogger } from "../lib/logger";
import {
  MINTS_POSTED_ID_HISTORY,
  type MintsCursorState,
  recordChannelPost,
  recordMintsCursor,
  resolveMintsCursor,
} from "../lib/state";
import type { Artifact, Config } from "../lib/types";
import { delay, getErrorMessage } from "../lib/utils";

const log = prefixedLogger("Mints");

/** GlyphBots brand color for embeds */
const GLYPHBOTS_COLOR: HexColorString = "#00ff88";

/** How many artifacts to pull per poll */
const FETCH_LIMIT = 50;

/** Etherscan transaction base URL */
const ETHERSCAN_TX_URL = "https://etherscan.io/tx/";

/** An artifact known to be minted on chain */
type MintedArtifact = Artifact & {
  mintedAt: string;
  contractTokenId: number;
};

/**
 * Status returned by initMintsChannel, matching the shape initLoreChannel uses
 */
export type MintsChannelStatus = {
  channelName: string;
  nextPostMinutes: number | null;
  status: string;
};

/**
 * Narrow to artifacts that actually made it on chain.
 * An artifact is only a mint once it has both a mint time and a token id.
 */
const isMinted = (artifact: Artifact): artifact is MintedArtifact =>
  artifact.mintedAt !== null &&
  artifact.mintedAt !== undefined &&
  artifact.contractTokenId !== null &&
  artifact.contractTokenId !== undefined;

/**
 * Parse mintedAt into epoch milliseconds, or null if it is unparseable
 */
const mintedAtMs = (artifact: MintedArtifact): number | null => {
  const ms = new Date(artifact.mintedAt).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Sort minted artifacts oldest first so the channel reads chronologically
 */
const sortOldestFirst = (artifacts: MintedArtifact[]): MintedArtifact[] =>
  [...artifacts].sort((a, b) => (mintedAtMs(a) ?? 0) - (mintedAtMs(b) ?? 0));

/**
 * Select the artifacts that are new relative to the cursor.
 *
 * The timestamp comparison is inclusive on the low end so mints sharing a
 * `mintedAt` with the cursor are still considered; the posted id set is what
 * actually rejects the ones already sent.
 */
const selectNewMints = (
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
 * Build the embed for a single minted artifact
 */
const buildMintEmbed = (artifact: MintedArtifact): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(GLYPHBOTS_COLOR)
    .setTitle(`◈ ${artifact.title} #${artifact.contractTokenId}`)
    .setURL(getArtifactUrl(artifact.contractTokenId));

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  fields.push({
    name: "◈ Bot",
    value: `[#${artifact.botTokenId}](${getBotUrl(artifact.botTokenId)})`,
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
    fields.push({
      name: "◈ Type",
      value: artifact.type,
      inline: true,
    });
  }

  const mintedSeconds = Math.floor(
    new Date(artifact.mintedAt).getTime() / 1000
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

/**
 * Post one mint embed to the channel. Returns false on any send failure.
 */
const postMint = async (
  channel: TextBasedChannel,
  artifact: MintedArtifact
): Promise<boolean> => {
  if (!channel.isSendable()) {
    log.error("Channel is not sendable");
    return false;
  }

  try {
    await channel.send({ embeds: [buildMintEmbed(artifact)] });
    log.info(
      `Posted mint: ${artifact.title} #${artifact.contractTokenId} (bot ${artifact.botTokenId})`
    );

    await recordChannelPost("mints", {
      artifactId: artifact.id,
      botName: `#${artifact.botTokenId}`,
      title: artifact.title,
    });

    return true;
  } catch (error) {
    log.error(`Failed to send mint message: ${getErrorMessage(error)}`);
    return false;
  }
};

/**
 * Post a single summary line for mints that were skipped by the burst guard
 */
const postBurstSummary = async (
  channel: TextBasedChannel,
  skipped: MintedArtifact[]
): Promise<void> => {
  if (skipped.length === 0 || !channel.isSendable()) {
    return;
  }

  const plural = skipped.length === 1 ? "artifact" : "artifacts";

  try {
    await channel.send({
      content: `◈ …and **${skipped.length}** more ${plural} minted in this batch.`,
    });
  } catch (error) {
    log.error(`Failed to send burst summary: ${getErrorMessage(error)}`);
  }
};

/**
 * Build the cursor that should be persisted after handling a batch of mints.
 *
 * Only handled artifacts get their ids recorded, so anything that failed to
 * send is eligible again next poll. The timestamp advances past everything
 * handled, but is then clamped to sit at or below the oldest failure, since a
 * mint that never made it to Discord must stay selectable. Successes newer than
 * that clamp are protected from a repost by their ids being in the set.
 */
const advanceCursor = (
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

/**
 * Seed the cursor on a cold start without posting the backlog
 */
const seedCursor = async (minted: MintedArtifact[]): Promise<void> => {
  const seeded = advanceCursor(
    { lastMintedAtMs: null, postedArtifactIds: [] },
    minted
  );

  await recordMintsCursor(seeded);

  log.info(
    `Seeded mint cursor at ${
      seeded.lastMintedAtMs
        ? new Date(seeded.lastMintedAtMs).toISOString()
        : "empty"
    }, skipped ${minted.length} historical mint${minted.length === 1 ? "" : "s"} (no backlog posted)`
  );
};

/**
 * Run one poll: fetch, diff against the cursor, post, and advance the cursor
 */
const pollOnce = async (channel: TextBasedChannel): Promise<number> => {
  const artifacts = await fetchRecentArtifacts(FETCH_LIMIT);

  if (artifacts.length === 0) {
    log.debug("No artifacts returned by the API");
    return 0;
  }

  const cursor = await resolveMintsCursor();

  if (!cursor) {
    await seedCursor(sortOldestFirst(artifacts.filter(isMinted)));
    return 0;
  }

  const newMints = selectNewMints(artifacts, cursor);

  if (newMints.length === 0) {
    log.debug("No new mints this poll");
    return 0;
  }

  log.info(`Detected ${newMints.length} new mint(s)`);

  // Burst guard: post the newest few individually, summarize the remainder.
  const toPost =
    newMints.length > MINTS_MAX_POSTS_PER_POLL
      ? newMints.slice(-MINTS_MAX_POSTS_PER_POLL)
      : newMints;
  const skipped =
    newMints.length > MINTS_MAX_POSTS_PER_POLL
      ? newMints.slice(0, newMints.length - MINTS_MAX_POSTS_PER_POLL)
      : [];

  if (skipped.length > 0) {
    log.warn(
      `Burst guard: posting ${toPost.length} of ${newMints.length} mints individually, summarizing ${skipped.length}`
    );
    await postBurstSummary(channel, skipped);
  }

  const handled: MintedArtifact[] = [...skipped];
  const failed: MintedArtifact[] = [];

  for (const [index, artifact] of toPost.entries()) {
    if (index > 0) {
      await delay(MINTS_POST_DELAY_MS);
    }
    if (await postMint(channel, artifact)) {
      handled.push(artifact);
    } else {
      failed.push(artifact);
    }
  }

  // Advance past everything handled, including the summarized ones, so a burst
  // is never replayed. A mint whose send failed is deliberately left behind the
  // timestamp so the next poll retries it; the posted id set is what keeps the
  // already-sent mints from being posted twice when that rewind happens.
  await recordMintsCursor(advanceCursor(cursor, handled, failed));

  if (failed.length > 0) {
    log.warn(
      `${failed.length} mint(s) failed to send, cursor held back for retry next poll`
    );
  }

  return handled.length - skipped.length;
};

/**
 * Initialize the mint watcher polling loop.
 *
 * Returns null when the channel is not configured or cannot be resolved, so a
 * bad channel id disables only this feature.
 */
export const initMintsChannel = async (
  client: Client,
  config: Config
): Promise<MintsChannelStatus | null> => {
  const { mintsChannelId } = config;

  if (!mintsChannelId) {
    log.debug("MINTS_CHANNEL_ID not set, mint watcher disabled");
    return null;
  }

  const channel = await resolveTextChannel(
    client,
    mintsChannelId,
    "MINTS_CHANNEL_ID"
  );

  if (!channel) {
    return null;
  }

  const channelName = getChannelDisplayName(channel, mintsChannelId);
  const intervalMs =
    MINTS_POLL_INTERVAL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

  const runPoll = async (): Promise<number> => {
    try {
      return await pollOnce(channel);
    } catch (error) {
      log.error(`Mint poll failed: ${getErrorMessage(error)}`);
      return 0;
    }
  };

  const posted = await runPoll();

  setInterval(() => {
    runPoll().catch((error) => {
      log.error(`Mint poll loop error: ${getErrorMessage(error)}`);
    });
  }, intervalMs);

  const status =
    posted > 0
      ? `Posted ${posted} new mint${posted === 1 ? "" : "s"}, polling every ${MINTS_POLL_INTERVAL_MINUTES} min`
      : `Watching, polling every ${MINTS_POLL_INTERVAL_MINUTES} min`;

  return {
    channelName,
    nextPostMinutes: MINTS_POLL_INTERVAL_MINUTES,
    status,
  };
};
