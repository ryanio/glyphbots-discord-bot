/**
 * Discord Channel Resolution
 *
 * Resolving a configured channel id can fail for reasons that are not fatal to
 * the bot: the channel was deleted, the id has a typo, or the bot lost access.
 * These helpers turn all of those into a loud log line and a null return so a
 * single bad id disables one feature instead of killing the process.
 */

import type { Client, TextBasedChannel } from "discord.js";
import { prefixedLogger } from "../logger";
import { getErrorMessage } from "../utils";

const log = prefixedLogger("Channels");

/**
 * Fetch a text-based channel by id, naming the env var in any failure.
 * Returns null instead of throwing when the channel is missing or unusable.
 */
export const resolveTextChannel = async (
  client: Client,
  channelId: string,
  envVar: string
): Promise<TextBasedChannel | null> => {
  let channel: Awaited<ReturnType<Client["channels"]["fetch"]>> = null;

  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    log.error(
      `❌ ${envVar}=${channelId} could not be fetched: ${getErrorMessage(error)}`
    );
    log.error(
      "❌ Check that the channel exists and the bot can see it. Feature disabled; the rest of the bot will keep running."
    );
    return null;
  }

  if (!channel) {
    log.error(
      `❌ ${envVar}=${channelId} does not exist (or the bot cannot see it). Feature disabled; the rest of the bot will keep running.`
    );
    return null;
  }

  if (!channel.isTextBased()) {
    log.error(
      `❌ ${envVar}=${channelId} is not a text channel. Feature disabled; the rest of the bot will keep running.`
    );
    return null;
  }

  return channel;
};

/**
 * Get a display name for a channel, falling back to its id
 */
export const getChannelDisplayName = (
  channel: TextBasedChannel,
  fallback: string
): string =>
  "name" in channel && channel.name ? channel.name : String(fallback);
