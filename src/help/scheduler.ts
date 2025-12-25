/**
 * Help Message Scheduler
 *
 * Periodic posting of help tips in playground channel.
 */

import {
  EmbedBuilder,
  type HexColorString,
  type TextChannel,
} from "discord.js";
import { prefixedLogger } from "../lib/logger";
import {
  arenaQuickstart,
  channelOverview,
  embedBotSyntax,
  slashCommands,
  spectatorGuide,
  TIPS,
} from "./embeds";

const log = prefixedLogger("HelpScheduler");

/** Help types for rotation */
export type HelpType =
  | "arena_quickstart"
  | "embed_bot_syntax"
  | "spectator_guide"
  | "slash_commands"
  | "channel_overview"
  | "tips_and_tricks";

/** All help types */
const HELP_TYPES: HelpType[] = [
  "arena_quickstart",
  "embed_bot_syntax",
  "spectator_guide",
  "slash_commands",
  "channel_overview",
  "tips_and_tricks",
];

/** Help scheduler state */
type SchedulerState = {
  lastHelpType: HelpType | null;
  lastTimestamp: number;
  recentTypes: HelpType[];
};

/** Max recent types to track */
const MAX_RECENT_TYPES = 5;

/** Help brand color */
const HELP_COLOR: HexColorString = "#ffaa00";

/** In-memory state */
const schedulerState: SchedulerState = {
  lastHelpType: null,
  lastTimestamp: 0,
  recentTypes: [],
};

/**
 * Get next help type (avoiding recent types)
 */
export const getNextHelpType = (): HelpType => {
  // Filter out recently posted types
  const available = HELP_TYPES.filter(
    (type) => !schedulerState.recentTypes.includes(type)
  );

  // If all types used recently, reset but avoid immediate repeat
  const pool =
    available.length > 0
      ? available
      : HELP_TYPES.filter((t) => t !== schedulerState.lastHelpType);

  return pool[Math.floor(Math.random() * pool.length)];
};

/**
 * Get embed for a help type
 */
export const getHelpEmbed = (type: HelpType): EmbedBuilder => {
  switch (type) {
    case "arena_quickstart":
      return arenaQuickstart;
    case "embed_bot_syntax":
      return embedBotSyntax;
    case "spectator_guide":
      return spectatorGuide;
    case "slash_commands":
      return slashCommands;
    case "channel_overview":
      return channelOverview;
    case "tips_and_tricks":
      return buildTipsEmbed();
    default:
      return arenaQuickstart;
  }
};

/**
 * Build a tips embed with random tips
 */
const buildTipsEmbed = (): EmbedBuilder => {
  // Pick 3 random tips
  const shuffled = [...TIPS].sort(() => Math.random() - 0.5);
  const selectedTips = shuffled.slice(0, 3);

  const embed = new EmbedBuilder()
    .setColor(HELP_COLOR)
    .setTitle("▸ Tips & Tricks")
    .setDescription("Quick tips to enhance your GlyphBots experience!");

  for (const tip of selectedTips) {
    embed.addFields({
      name: tip.title,
      value: tip.tip,
    });
  }

  embed.setFooter({ text: "Use /tips for more tips anytime!" });

  return embed;
};

/**
 * Record that a help message was posted
 */
export const recordHelpPost = (type: HelpType): void => {
  schedulerState.lastHelpType = type;
  schedulerState.lastTimestamp = Date.now();

  schedulerState.recentTypes.push(type);
  if (schedulerState.recentTypes.length > MAX_RECENT_TYPES) {
    schedulerState.recentTypes.shift();
  }

  log.info(`Recorded help post: ${type}`);
};

/**
 * Post a help message to a channel
 */
export const postHelpMessage = async (
  channel: TextChannel
): Promise<boolean> => {
  const helpType = getNextHelpType();
  const embed = getHelpEmbed(helpType);

  try {
    await channel.send({ embeds: [embed] });
    recordHelpPost(helpType);
    log.info(`Posted help message: ${helpType}`);
    return true;
  } catch (error) {
    log.error("Failed to post help message:", error);
    return false;
  }
};

/**
 * Generate a help embed for the rotation
 */
export const generateHelpEmbed = (): EmbedBuilder => {
  const helpType = getNextHelpType();
  recordHelpPost(helpType);
  return getHelpEmbed(helpType);
};
