/**
 * Link button rows, the raw-builders equivalent of `src/lib/discord/buttons.ts`.
 *
 * Two differences from the Node bot, both forced by using `@discordjs/builders`
 * directly instead of discord.js:
 *
 * - `setEmoji` takes `{ name: "🤖" }` here. The bare-string overload the
 *   handlers used is a discord.js convenience on top of the builder.
 * - The row is returned as plain JSON, because that is what goes into the
 *   follow-up body.
 *
 * Every button in the eight in-scope commands is `ButtonStyle.Link`, so there
 * is no `custom_id` anywhere and no component interaction to route back. The
 * interactions endpoint therefore needs no `MESSAGE_COMPONENT` handler.
 */

import { ActionRowBuilder, ButtonBuilder } from "@discordjs/builders";
import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
} from "discord-api-types/v10";
import { ButtonStyle } from "discord-api-types/v10";

export type LinkButton = {
  label: string;
  url: string;
  emoji: string;
};

export const linkButton = (button: LinkButton): ButtonBuilder =>
  new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(button.label)
    .setURL(button.url)
    .setEmoji({ name: button.emoji });

/** One action row of link buttons, ready to drop into a follow-up body. */
export const linkButtonRow = (
  buttons: LinkButton[]
): APIActionRowComponent<APIComponentInMessageActionRow> =>
  new ActionRowBuilder<ButtonBuilder>()
    .addComponents(buttons.map(linkButton))
    .toJSON() as APIActionRowComponent<APIComponentInMessageActionRow>;
