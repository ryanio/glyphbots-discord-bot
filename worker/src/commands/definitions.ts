/**
 * The eight command definitions, as raw registration JSON.
 *
 * These are the exact eight that survive the port. Seventeen are registered on
 * the guild today; the single `PUT` in `scripts/register-commands.ts` replaces
 * the whole set, which prunes the other nine atomically. The nine going away:
 * `arena`, `help`, `info`, `mybots`, `random`, `spotlight`, `stats`, `tips`,
 * `wallet`.
 *
 * Written as plain objects rather than through `SlashCommandBuilder` because
 * the builder's option methods live in the discord.js half of the API surface
 * and this package does not depend on discord.js. The shape is the REST body,
 * so it is what Discord validates anyway.
 *
 * One copy change from the Node bot's registration payload
 * (`src/commands/index.ts:126-129` at `c75d6a8`): `/bot`'s `random`
 * option no longer says "uses your owned bots if wallet connected". Per-user
 * wallet storage is not built (decision 7), so the description must not
 * advertise it. See the note in `./bot.ts`.
 */

import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { MAX_BOT_TOKEN_ID } from "../config";

/** The `bot` integer option, identical across `/owner`, `/rarity`, `/activity`. */
const botTokenOption = {
  type: ApplicationCommandOptionType.Integer,
  name: "bot",
  description: `Bot token ID (1-${MAX_BOT_TOKEN_ID})`,
  required: true,
  min_value: 1,
  max_value: MAX_BOT_TOKEN_ID,
} as const;

export const commandDefinitions: RESTPostAPIChatInputApplicationCommandsJSONBody[] =
  [
    {
      name: "bot",
      description: "Display a GlyphBot with full details and OpenSea data",
      options: [
        {
          type: ApplicationCommandOptionType.Integer,
          name: "id",
          description: `Bot token ID (1-${MAX_BOT_TOKEN_ID})`,
          required: false,
          min_value: 1,
          max_value: MAX_BOT_TOKEN_ID,
        },
        {
          type: ApplicationCommandOptionType.Boolean,
          name: "random",
          description: "Show a random bot from the collection",
          required: false,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: "user",
          description:
            "OpenSea username or wallet address to pick a random bot from",
          required: false,
        },
      ],
    },
    {
      name: "artifact",
      description: "Display a GlyphBots artifact with details",
      options: [
        {
          type: ApplicationCommandOptionType.Integer,
          name: "id",
          description: "Artifact contract token ID",
          required: false,
          min_value: 1,
        },
        {
          type: ApplicationCommandOptionType.Boolean,
          name: "random",
          description: "Show a random recent artifact",
          required: false,
        },
      ],
    },
    {
      name: "floor",
      description: "View GlyphBots collection stats and floor price",
    },
    {
      name: "sales",
      description: "View recent GlyphBots sales on OpenSea",
    },
    {
      name: "listings",
      description: "View cheapest GlyphBots currently listed for sale",
    },
    {
      name: "owner",
      description: "Check who owns a specific GlyphBot",
      options: [botTokenOption],
    },
    {
      name: "rarity",
      description: "Check a GlyphBot's rarity rank and traits",
      options: [botTokenOption],
    },
    {
      name: "activity",
      description: "View recent activity for a specific GlyphBot",
      options: [botTokenOption],
    },
  ];
