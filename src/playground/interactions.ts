/**
 * Playground Interaction Handlers
 *
 * Handles button clicks for playground content.
 */

import type { ButtonInteraction } from "discord.js";
import { handleInteractionError, replyWithError } from "../lib/discord/errors";
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
      await replyWithError(interaction, "◉ Failed to generate new spotlight.");
      return;
    }

    await interaction.editReply({
      embeds: [result.embed],
      components: result.components,
    });
  } catch (error) {
    await handleInteractionError(
      interaction,
      error,
      log,
      "generating new spotlight"
    );
    await replyWithError(
      interaction,
      "◉ An error occurred while generating spotlight."
    );
  }
};

/**
 * Handle arena challenge button from recap
 */
export const handleArenaChallenge = async (
  interaction: ButtonInteraction
): Promise<void> => {
  await replyWithError(
    interaction,
    "◉ Use `/arena challenge` to start a battle!"
  );
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
      await replyWithError(interaction, "◉ Opening link...");
    } else {
      await replyWithError(interaction, "◉ Unknown playground action.");
    }
  } catch (error) {
    await handleInteractionError(interaction, error, log, `button ${customId}`);
  }
};
