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
import { generateLoreNarrative } from "../api/openrouter";
import { prefixedLogger } from "../lib/logger";
import { recordLorePost } from "../lib/state";
import type {
  Artifact,
  Config,
  GeneratedLore,
  LoreContext,
} from "../lib/types";
import {
  getErrorMessage,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
  weightedRandomIndex,
} from "../lib/utils";

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
  const { title, artifact, bot } = lore;

  const embed = new EmbedBuilder().setColor(GLYPHBOTS_COLOR).setTitle(title);

  // Add artifact image if available
  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  // Add fields for context
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  fields.push({
    name: "Bot",
    value: `[${bot.name} #${bot.tokenId}](${getBotUrl(bot.tokenId)})`,
    inline: true,
  });

  // Only add artifact link if it has a contract token ID
  if (artifact.contractTokenId) {
    fields.push({
      name: "Artifact",
      value: `[${artifact.title}](${getArtifactUrl(artifact.contractTokenId)})`,
      inline: true,
    });
  } else {
    fields.push({
      name: "Artifact",
      value: artifact.title,
      inline: true,
    });
  }

  if (artifact.mintedAt) {
    const mintDate = new Date(artifact.mintedAt);
    fields.push({
      name: "Minted",
      value: mintDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
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
): Promise<void> => {
  const { loreChannelId, loreIntervalMinutes } = config;

  log.info(`Initializing lore channel: ${loreChannelId}`);
  log.info(`Posting interval: ${loreIntervalMinutes} minutes`);

  // Fetch the channel
  const channel = await client.channels.fetch(loreChannelId);

  if (!channel?.isTextBased()) {
    throw new Error(`Channel ${loreChannelId} is not a text channel`);
  }

  const channelName = "name" in channel ? channel.name : loreChannelId;
  log.info(`Connected to lore channel: #${channelName}`);

  // Post initial lore entry
  log.info("Posting initial lore entry...");
  const success = await postLoreEntry(channel);

  if (!success) {
    log.warn("Initial lore post failed, will retry on next interval");
  }

  // Set up interval for recurring posts
  const intervalMs = loreIntervalMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

  setInterval(async () => {
    log.info("Scheduled lore post triggered");
    await postLoreEntry(channel);
  }, intervalMs);

  log.info(
    `Lore scheduler active: posting every ${loreIntervalMinutes} minutes`
  );
};
