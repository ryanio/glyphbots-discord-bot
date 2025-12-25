/**
 * Playground Channel Handler
 *
 * Manages the playground channel with rotating community content.
 */

import type { Client, EmbedBuilder, TextChannel } from "discord.js";
import { generateHelpEmbed } from "../help/scheduler";
import { prefixedLogger } from "../lib/logger";
import type { Config } from "../lib/types";
import { delay } from "../lib/utils";
import { generateDiscovery } from "../playground/discovery";
import { generateEncounter } from "../playground/encounter";
import { generatePostcard } from "../playground/postcard";
import { generateRecap } from "../playground/recap";
import {
  type ContentType,
  calculateNextInterval,
  recordContentPost,
  selectNextContentType,
} from "../playground/rotation";
import { generateSpotlight } from "../playground/spotlight";

const log = prefixedLogger("Playground");

/** Playground channel state */
type PlaygroundState = {
  channel: TextChannel;
  config: Config;
  isActive: boolean;
};

/** Channel state */
let playgroundState: PlaygroundState | null = null;

/**
 * Generate content based on type
 */
const generateContent = async (
  type: ContentType
): Promise<{
  embed: EmbedBuilder;
  components?: import("discord.js").ActionRowBuilder<
    import("discord.js").ButtonBuilder
  >[];
} | null> => {
  log.info(`Generating content: ${type}`);

  switch (type) {
    case "spotlight":
      return await generateSpotlight();
    case "postcard":
      return await generatePostcard();
    case "discovery":
      return await generateDiscovery();
    case "recap":
      return await generateRecap();
    case "encounter":
      return await generateEncounter();
    case "help": {
      const embed = await generateHelpEmbed();
      return embed ? { embed, components: [] } : null;
    }
    default:
      log.warn(`Unknown content type: ${type}`);
      return null;
  }
};

/**
 * Post content to the playground channel
 */
const postContent = async (): Promise<boolean> => {
  if (!playgroundState) {
    log.warn("Playground state not initialized");
    return false;
  }

  const contentType = selectNextContentType();

  try {
    const content = await generateContent(contentType);
    if (!content) {
      log.warn(`Failed to generate content: ${contentType}`);
      return false;
    }

    await playgroundState.channel.send({
      embeds: [content.embed],
      components: content.components,
    });
    recordContentPost(contentType);

    log.info(`Posted content: ${contentType}`);
    return true;
  } catch (error) {
    log.error("Failed to post content:", error);
    return false;
  }
};

/**
 * Content posting loop
 */
const contentLoop = async (): Promise<void> => {
  if (!playgroundState) {
    return;
  }

  while (playgroundState.isActive) {
    // Calculate next interval
    const interval = calculateNextInterval(
      playgroundState.config.playgroundMinIntervalMinutes,
      playgroundState.config.playgroundMaxIntervalMinutes
    );

    // Log only when actually posting (not on startup)

    // Wait for interval
    await delay(interval);

    // Post content if still active
    if (playgroundState.isActive) {
      await postContent();
    }
  }
};

/**
 * Initialize the playground channel
 */
export const initPlaygroundChannel = async (
  client: Client,
  config: Config
): Promise<{
  channelName: string;
  nextPostMinutes: number;
  status: string;
} | null> => {
  if (!config.playgroundChannelId) {
    return null;
  }

  try {
    const channel = await client.channels.fetch(config.playgroundChannelId);
    if (!(channel && "send" in channel)) {
      log.error("Playground channel not found or invalid");
      return null;
    }

    const channelName =
      "name" in channel && channel.name
        ? channel.name
        : String(config.playgroundChannelId);

    playgroundState = {
      channel: channel as TextChannel,
      config,
      isActive: true,
    };

    // Calculate next interval for status
    const nextInterval = calculateNextInterval(
      config.playgroundMinIntervalMinutes,
      config.playgroundMaxIntervalMinutes
    );
    const nextPostMinutes = Math.round(nextInterval / 60_000);

    // Start the content loop
    contentLoop().catch((error) => {
      log.error("Playground content loop error:", error);
    });

    return {
      channelName,
      nextPostMinutes,
      status: "Content loop active",
    };
  } catch (error) {
    log.error("Failed to initialize playground channel:", error);
    return null;
  }
};

/**
 * Stop the playground channel
 */
export const stopPlaygroundChannel = (): void => {
  if (playgroundState) {
    playgroundState.isActive = false;
    playgroundState = null;
    log.info("Playground channel stopped");
  }
};
