/**
 * Playground Interaction Handlers
 *
 * Handles button clicks for playground content.
 */

import type { ButtonInteraction } from "discord.js";
import { postUserTriggeredContent } from "../channels/playground";
import { handleInteractionError, replyWithError } from "../lib/discord/errors";
import { prefixedLogger } from "../lib/logger";
import {
  canUserPerformAction,
  formatTimeRemaining,
  getActionTimeRemaining,
  recordUserAction,
  type UserActionType,
} from "./rate-limit";
import { generateSpotlight } from "./spotlight";

const log = prefixedLogger("PlaygroundInteract");

/**
 * Handle user action request with rate limiting
 */
const handleUserAction = async (
  interaction: ButtonInteraction,
  actionType: UserActionType,
  contentType:
    | "spotlight"
    | "discovery"
    | "encounter"
    | "postcard"
    | "recap"
    | "help"
): Promise<void> => {
  const userId = interaction.user.id;

  const canPerform = await canUserPerformAction(userId, actionType);
  if (!canPerform) {
    const timeRemaining = await getActionTimeRemaining(userId, actionType);
    const timeStr = formatTimeRemaining(timeRemaining);
    await replyWithError(
      interaction,
      `◉ Rate limited! You can request this again in ${timeStr}. (Max 1 per 6 hours per action type)`
    );
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const success = await postUserTriggeredContent(contentType);
    if (!success) {
      await replyWithError(
        interaction,
        `◉ Failed to generate ${contentType}. Please try again later.`
      );
      return;
    }

    await recordUserAction(userId, actionType);

    await interaction.editReply({
      content: `◉ ✅ Posted new ${contentType} to the playground!`,
    });
  } catch (error) {
    await handleInteractionError(
      interaction,
      error,
      log,
      `generating ${contentType}`
    );
    await replyWithError(
      interaction,
      `◉ An error occurred while generating ${contentType}.`
    );
  }
};

/**
 * Handle new spotlight button (in-place update)
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
    } else if (customId === "playground_request_spotlight") {
      await handleUserAction(interaction, "request_spotlight", "spotlight");
    } else if (customId === "playground_request_discovery") {
      await handleUserAction(interaction, "request_discovery", "discovery");
    } else if (customId === "playground_request_encounter") {
      await handleUserAction(interaction, "request_encounter", "encounter");
    } else if (customId === "playground_request_postcard") {
      await handleUserAction(interaction, "request_postcard", "postcard");
    } else if (customId === "playground_request_recap") {
      await handleUserAction(interaction, "request_recap", "recap");
    } else if (customId === "playground_request_help") {
      await handleUserAction(interaction, "request_help", "help");
    } else if (customId === "playground_arena_challenge") {
      await handleArenaChallenge(interaction);
    } else {
      await replyWithError(interaction, "◉ Unknown playground action.");
    }
  } catch (error) {
    await handleInteractionError(interaction, error, log, `button ${customId}`);
  }
};
