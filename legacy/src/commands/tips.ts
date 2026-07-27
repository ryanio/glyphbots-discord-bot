/**
 * /tips Command Handler
 *
 * Get a helpful GlyphBots tip.
 */

import type { ChatInputCommandInteraction } from "discord.js";
import { getRandomTipEmbed } from "../help/embeds";

/**
 * Handle /tips command
 */
export const handleTips = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const embed = getRandomTipEmbed();
  await interaction.reply({ embeds: [embed] });
};
