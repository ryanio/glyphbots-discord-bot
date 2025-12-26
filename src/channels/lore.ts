import {
  type Client,
  EmbedBuilder,
  type HexColorString,
  type TextBasedChannel,
} from "discord.js";
import {
  fetchBot,
  fetchBotStory,
  fetchRecentArtifacts,
  getArtifactUrl,
  getBotUrl,
} from "../api/glyphbots";
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from "../lib/constants";
import { prefixedLogger } from "../lib/logger";
import { recordLorePost, resolveLastPostInfo } from "../lib/state";
import type {
  Artifact,
  Config,
  GeneratedLore,
  LoreContext,
} from "../lib/types";
import { getErrorMessage, weightedRandomIndex } from "../lib/utils";
import { generateLoreNarrative } from "../lore/generate";

const log = prefixedLogger("Lore");

/** GlyphBots brand color for embeds */
const GLYPHBOTS_COLOR: HexColorString = "#00ff88";

/** Maximum retries when selecting an artifact */
const MAX_SELECTION_RETRIES = 5;

/** Track recently posted artifact IDs to avoid duplicates */
const recentArtifacts = new Set<string>();

/** Maximum size of recent artifacts cache */
const MAX_RECENT_CACHE_SIZE = 50;

/**
 * Add artifact to recent cache, pruning old entries if needed
 */
const trackRecentArtifact = (artifactId: string): void => {
  recentArtifacts.add(artifactId);

  // Prune oldest entries if cache is too large
  if (recentArtifacts.size > MAX_RECENT_CACHE_SIZE) {
    const oldest = recentArtifacts.values().next().value;
    if (oldest !== undefined) {
      recentArtifacts.delete(oldest);
    }
  }
};

/**
 * Select a random artifact with weighting towards recent mints
 * Returns null if no valid artifact can be found
 */
const selectWeightedArtifact = async (): Promise<Artifact | null> => {
  log.debug("Fetching recent artifacts for weighted selection");

  const artifacts = await fetchRecentArtifacts(50);

  if (artifacts.length === 0) {
    log.warn("No recent artifacts available");
    return null;
  }

  // Filter out recently posted artifacts
  const availableArtifacts = artifacts.filter(
    (a) => !recentArtifacts.has(a.id)
  );

  if (availableArtifacts.length === 0) {
    log.info("All recent artifacts have been posted, allowing repeats");
    recentArtifacts.clear();
  }

  const pool = availableArtifacts.length > 0 ? availableArtifacts : artifacts;

  // Use weighted random to favor more recent artifacts (lower index = more recent)
  // Invert the weighting since index 0 is most recent
  const maxIndex = pool.length;
  const weightedIdx = maxIndex - weightedRandomIndex(maxIndex, 1.5);
  const selectedIndex = Math.max(0, Math.min(weightedIdx, pool.length - 1));

  const selected = pool.at(selectedIndex);

  if (!selected) {
    log.error("Failed to select artifact from pool");
    return null;
  }

  log.info(
    `Selected artifact: ${selected.title} (index ${selectedIndex}/${pool.length})`
  );
  trackRecentArtifact(selected.id);

  return selected;
};

/**
 * Build the lore context for an artifact
 */
const buildLoreContext = async (
  artifact: Artifact
): Promise<LoreContext | null> => {
  const { botTokenId } = artifact;

  if (!botTokenId) {
    log.warn(`Artifact ${artifact.id} has no associated bot`);
    return null;
  }

  log.debug(`Fetching bot ${botTokenId} for artifact ${artifact.id}`);

  const bot = await fetchBot(botTokenId);

  if (!bot) {
    log.error(`Failed to fetch bot ${botTokenId}`);
    return null;
  }

  // Story is optional - some bots may not have story data
  const story = await fetchBotStory(botTokenId);

  if (!story) {
    log.debug(`No story data for bot ${botTokenId}, proceeding without`);
  }

  return { artifact, bot, story };
};

/**
 * Build a Discord embed for lore (image and metadata only, no narrative)
 */
const buildLoreEmbed = (lore: GeneratedLore): EmbedBuilder => {
  const { artifact, bot } = lore;

  const embed = new EmbedBuilder().setColor(GLYPHBOTS_COLOR);

  // Add artifact image if available
  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  // Add fields for context - artifact first, ID at end
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  // Artifact first
  if (artifact.contractTokenId) {
    fields.push({
      name: "◈ Artifact",
      value: `[${artifact.title} #${artifact.contractTokenId}](${getArtifactUrl(artifact.contractTokenId)})`,
      inline: true,
    });
  } else {
    fields.push({
      name: "◈ Artifact",
      value: artifact.title,
      inline: true,
    });
  }

  // Bot second, ID at end
  fields.push({
    name: "◈ Bot",
    value: `[${bot.name} #${bot.tokenId}](${getBotUrl(bot.tokenId)})`,
    inline: true,
  });

  // Minted date
  if (artifact.mintedAt) {
    const mintDate = new Date(artifact.mintedAt);
    const year = mintDate.getFullYear();
    const shortYear = `'${year.toString().slice(-2)}`;
    fields.push({
      name: "◉ Minted",
      value: `${mintDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })} ${shortYear}`,
      inline: true,
    });
  }

  embed.addFields(fields);

  return embed;
};

/**
 * Generate and post a lore entry to the channel
 */
const postLoreEntry = async (channel: TextBasedChannel): Promise<boolean> => {
  log.info("Generating new lore entry");

  // Select artifact with retries
  let artifact: Artifact | null = null;
  let context: LoreContext | null = null;

  for (let attempt = 1; attempt <= MAX_SELECTION_RETRIES; attempt++) {
    artifact = await selectWeightedArtifact();

    if (!artifact) {
      log.warn(`Artifact selection failed (attempt ${attempt})`);
      continue;
    }

    context = await buildLoreContext(artifact);

    if (context) {
      break;
    }

    log.warn(
      `Context build failed for artifact ${artifact.id} (attempt ${attempt})`
    );
  }

  if (!context) {
    log.error("Failed to build lore context after retries");
    return false;
  }

  // Generate the narrative
  const lore = await generateLoreNarrative(context);

  if (!lore) {
    log.error("Failed to generate lore narrative");
    return false;
  }

  // Build embed (image and metadata)
  const embed = buildLoreEmbed(lore);

  try {
    if (!channel.isSendable()) {
      log.error("Channel is not sendable");
      return false;
    }

    // Send narrative as text content, embed has image and metadata
    await channel.send({
      content: lore.narrative,
      embeds: [embed],
    });
    log.info(`Posted lore for ${lore.bot.name}: ${lore.artifact.title}`);

    // Record the post to state
    await recordLorePost({
      artifactId: lore.artifact.id,
      botName: lore.bot.name,
      title: lore.title,
    });

    return true;
  } catch (error) {
    log.error(`Failed to send lore message: ${getErrorMessage(error)}`);
    return false;
  }
};

/**
 * Initialize the lore channel scheduler
 */
export const initLoreChannel = async (
  client: Client,
  config: Config
): Promise<{
  channelName: string;
  nextPostMinutes: number | null;
  status: string;
}> => {
  const { loreChannelId, loreMinIntervalMinutes, loreMaxIntervalMinutes } =
    config;

  // Fetch the channel
  const channel = await client.channels.fetch(loreChannelId);

  if (!channel?.isTextBased()) {
    throw new Error(`Channel ${loreChannelId} is not a text channel`);
  }

  const channelName =
    "name" in channel && channel.name ? channel.name : String(loreChannelId);

  // Calculate random interval between min and max
  const getRandomInterval = (): number => {
    const minMs = loreMinIntervalMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;
    const maxMs = loreMaxIntervalMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  };

  // Set up interval for recurring posts with random intervals
  const scheduleNextPost = (): void => {
    const nextIntervalMs = getRandomInterval();
    setTimeout(async () => {
      log.info("Scheduled lore post triggered");
      await postLoreEntry(channel);
      scheduleNextPost();
    }, nextIntervalMs);
  };

  // Check last post time from state
  const lastPost = await resolveLastPostInfo("lore");
  const nowMs = Date.now();
  let nextPostMinutes: number | null = null;
  let status = "Initializing";

  if (lastPost) {
    const lastPostMs = lastPost.timestamp * MS_PER_SECOND;
    const timeSinceLastPost = nowMs - lastPostMs;
    const minIntervalMs =
      loreMinIntervalMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

    // If less than minimum interval has passed, wait for the remainder
    if (timeSinceLastPost < minIntervalMs) {
      const timeUntilNextPost = minIntervalMs - timeSinceLastPost;
      nextPostMinutes = Math.ceil(
        timeUntilNextPost / (SECONDS_PER_MINUTE * MS_PER_SECOND)
      );
      const minutesAgo = Math.floor(
        timeSinceLastPost / (SECONDS_PER_MINUTE * MS_PER_SECOND)
      );
      status = `Last post ${minutesAgo} min ago, waiting ${nextPostMinutes} min`;

      // Schedule the first post after the remaining time
      setTimeout(async () => {
        log.info("Scheduled lore post triggered (initial delay)");
        await postLoreEntry(channel);
        scheduleNextPost();
      }, timeUntilNextPost);
    } else {
      // Enough time has passed, post now
      const success = await postLoreEntry(channel);
      if (success) {
        status = "Posted initial entry";
      } else {
        log.warn("Initial lore post failed, will retry on next interval");
        status = "Initial post failed, will retry";
      }
      scheduleNextPost();
    }
  } else {
    // No previous post, post now
    const success = await postLoreEntry(channel);
    if (success) {
      status = "Posted initial entry";
    } else {
      log.warn("Initial lore post failed, will retry on next interval");
      status = "Initial post failed, will retry";
    }
    scheduleNextPost();
  }

  return {
    channelName,
    nextPostMinutes,
    status,
  };
};
