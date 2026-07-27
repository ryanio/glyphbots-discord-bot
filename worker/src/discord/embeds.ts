/**
 * Embed shorthands, built on `@discordjs/builders` rather than discord.js.
 *
 * The handlers all built the same "red embed, title, description, done" shape
 * for their not-found and bad-input branches, so it lives here once.
 */

import type { EmbedBuilder } from "@discordjs/builders";
import type { APIEmbed } from "discord-api-types/v10";
import { COLORS } from "../config";
import type { FollowUp } from "./interactions";

/** A red single-embed reply. Used for every not-found and bad-input branch. */
export const errorReply = (title: string, description: string): FollowUp => ({
  embeds: [{ color: COLORS.error, title, description }],
});

/**
 * Escape Discord markdown in text that came from a third party
 * (`opensea-activity-bot/src/platforms/discord/utils.ts:51-52`). OpenSea
 * usernames and bios are user-chosen and regularly contain underscores, which
 * Discord reads as italics.
 */
export const escapeMarkdown = (text: string): string =>
  text.replace(/(?<special>[_*~`|>])/g, "\\$<special>");

/** One embed plus an optional button row, as a follow-up body. */
export const embedReply = (
  embed: EmbedBuilder,
  components?: FollowUp["components"]
): FollowUp => ({
  embeds: [embed.toJSON() as APIEmbed],
  ...(components ? { components } : {}),
});
