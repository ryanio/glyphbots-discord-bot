/**
 * Discord Button Utilities
 *
 * Common button building patterns for DRY code.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getArtifactUrl, getBotUrl } from "../../api/glyphbots";

/**
 * Create a link button for viewing a bot
 */
export function createBotLinkButton(
  tokenId: number,
  label?: string,
  customId?: string
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId ?? `view_bot_${tokenId}`)
    .setLabel(label ?? `View Bot #${tokenId}`)
    .setStyle(ButtonStyle.Link)
    .setURL(getBotUrl(tokenId));
}

/**
 * Create a link button for viewing an artifact
 */
export function createArtifactLinkButton(
  contractTokenId: number,
  label?: string,
  customId?: string
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId ?? `view_artifact_${contractTokenId}`)
    .setLabel(label ?? "View Artifact")
    .setStyle(ButtonStyle.Link)
    .setURL(getArtifactUrl(contractTokenId));
}

/**
 * Create an action row with a single button
 */
export function createButtonRow(
  button: ButtonBuilder
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

/**
 * Create an action row with multiple buttons
 */
export function createButtonRowWithButtons(
  ...buttons: ButtonBuilder[]
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

/**
 * Create a standard button (non-link)
 */
export function createButton(
  customId: string,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
  emoji?: string
): ButtonBuilder {
  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);

  if (emoji) {
    button.setEmoji(emoji);
  }

  return button;
}
