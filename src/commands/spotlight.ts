/**
 * /spotlight Command Handler
 *
 * Shows the current featured bot.
 */

import type { ChatInputCommandInteraction } from "discord.js";
import { prefixedLogger } from "../lib/logger";
import { generateSpotlight } from "../playground/spotlight";

const log = prefixedLogger("SpotlightCmd");

/**
 * Handle /spotlight command
 */
export const handleSpotlight = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  await interaction.deferReply();

  log.info(`Spotlight requested by ${interaction.user.username}`);

  const embed = await generateSpotlight();
  if (!embed) {
    await interaction.editReply({
      content: "❌ Failed to generate spotlight. Please try again later.",
    });
    return;
  }

  await interaction.editReply({ embeds: [embed] });
};
