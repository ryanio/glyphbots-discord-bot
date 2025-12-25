/**
 * Discord Embed Utilities
 *
 * Common embed building patterns for DRY code.
 */

import { EmbedBuilder, type HexColorString } from "discord.js";
import { getArtifactUrl, getBotUrl } from "../../api/glyphbots";

/**
 * Common Discord embed colors
 */
export const EMBED_COLORS = {
  ERROR: "#ff4444" as HexColorString,
  SUCCESS: "#00ff88" as HexColorString,
  ARENA: "#ff4444" as HexColorString,
  GLYPHBOTS: "#00aaff" as HexColorString,
} as const;

/**
 * Format a bot link in markdown
 */
export function formatBotLink(tokenId: number, label?: string): string {
  const text = label ?? `#${tokenId}`;
  return `[${text}](${getBotUrl(tokenId)})`;
}

/**
 * Format an artifact link in markdown
 */
export function formatArtifactLink(
  contractTokenId: number,
  label?: string
): string {
  const text = label ?? `Artifact #${contractTokenId}`;
  return `[${text}](${getArtifactUrl(contractTokenId)})`;
}

/**
 * Create a base embed with color
 */
export function createEmbed(
  color: HexColorString,
  title?: string,
  description?: string
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(color);

  if (title) {
    embed.setTitle(title);
  }

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

/**
 * Create an embed with a bot URL
 */
export function createBotEmbed(
  tokenId: number,
  color: HexColorString,
  title?: string,
  description?: string
): EmbedBuilder {
  const embed = createEmbed(color, title, description);
  embed.setURL(getBotUrl(tokenId));
  return embed;
}

/**
 * Create an embed with an artifact URL
 */
export function createArtifactEmbed(
  contractTokenId: number,
  color: HexColorString,
  title?: string,
  description?: string
): EmbedBuilder {
  const embed = createEmbed(color, title, description);
  embed.setURL(getArtifactUrl(contractTokenId));
  return embed;
}

/**
 * Create an error embed
 */
export function createErrorEmbed(
  title: string,
  description: string,
  color: HexColorString = EMBED_COLORS.ERROR
): EmbedBuilder {
  return createEmbed(color, title, description);
}
