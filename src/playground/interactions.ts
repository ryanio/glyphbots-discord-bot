/**
 * Playground Interaction Handlers
 *
 * Handles button clicks for playground content.
 */

import type { ButtonInteraction } from "discord.js";
import { prefixedLogger } from "../lib/logger";
import { generateSpotlight } from "./spotlight";

const log = prefixedLogger("PlaygroundInteract");

/**
 * Handle new spotlight button
 */
export const handleNewSpotlight = async (
  interaction: ButtonInteraction
): Promise<void> => {
  await interaction.deferUpdate();

  try {
    const result = await generateSpotlight();
    if (!result) {
      await interaction.followUp({
        content: "◉ Failed to generate new spotlight.",
        ephemeral: true,
      });
      return;
    }

    await interaction.editReply({
      embeds: [result.embed],
      components: result.components,
    });
  } catch (error) {
    log.error("Error generating new spotlight:", error);
    await interaction.followUp({
      content: "◉ An error occurred while generating spotlight.",
      ephemeral: true,
    });
  }
};

/**
 * Handle arena challenge button from recap
 */
export const handleArenaChallenge = async (
  interaction: ButtonInteraction
): Promise<void> => {
  await interaction.reply({
    content: "◉ Use `/arena challenge` to start a battle!",
    ephemeral: true,
  });
};

/**
 * Main playground button interaction router
 */
export const handlePlaygroundButton = async (
  interaction: ButtonInteraction
): Promise<void> => {
  const { customId } = interaction;

  try {
    if (customId === "playground_new_spotlight") {
      await handleNewSpotlight(interaction);
    } else if (customId === "playground_arena_challenge") {
      await handleArenaChallenge(interaction);
    } else if (
      customId.startsWith("playground_view_bot_") ||
      customId.startsWith("playground_view_artifact_")
    ) {
      // Link buttons don't need handlers - they open URLs directly
      // But we can acknowledge if needed
      await interaction.reply({
        content: "◉ Opening link...",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "◉ Unknown playground action.",
        ephemeral: true,
      });
    }
  } catch (error) {
    log.error(`Error handling playground button ${customId}:`, error);
    if (!(interaction.replied || interaction.deferred)) {
      await interaction.reply({
        content: "◉ An error occurred.",
        ephemeral: true,
      });
    }
  }
};
