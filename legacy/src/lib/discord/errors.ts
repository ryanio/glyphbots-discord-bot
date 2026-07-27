/**
 * Discord Error Handling Utilities
 *
 * Common error reply patterns for consistent error handling.
 */

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";

/**
 * Standard error reply for interactions
 */
export async function replyWithError(
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | StringSelectMenuInteraction,
  message: string
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content: message,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: message,
      ephemeral: true,
    });
  }
}

/**
 * Standard "unknown" error reply
 */
export async function replyWithUnknownError(
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | StringSelectMenuInteraction,
  type: "button" | "command" | "menu" = "button"
): Promise<void> {
  const messages = {
    button: "Unknown button.",
    command: "Unknown command.",
    menu: "Unknown select menu.",
  };

  await replyWithError(interaction, messages[type]);
}

/**
 * Standard generic error reply
 */
export async function replyWithGenericError(
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | StringSelectMenuInteraction
): Promise<void> {
  await replyWithError(interaction, "An error occurred.");
}

/**
 * Handle interaction errors with logging
 */
export async function handleInteractionError(
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | StringSelectMenuInteraction,
  error: unknown,
  logger: { error: (message: string, error: unknown) => void },
  context?: string
): Promise<void> {
  const contextMsg = context ? ` (${context})` : "";
  logger.error(`Error handling interaction${contextMsg}:`, error);

  if (!(interaction.replied || interaction.deferred)) {
    await replyWithGenericError(interaction);
  }
}
