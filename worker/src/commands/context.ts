/**
 * What a command handler is handed, and how it reads its options.
 *
 * On the gateway a handler took a `ChatInputCommandInteraction` and pulled
 * options off `interaction.options.getInteger(...)`. That object comes from
 * discord.js, which is not here. The raw HTTP payload carries the same data as
 * a flat `data.options` array, so `readOptions` rebuilds the three accessors
 * the eight commands actually used and nothing more.
 *
 * The clients are built from the live `env` by the caller and passed in, so a
 * handler never reaches for configuration itself.
 */

import type {
  APIApplicationCommandInteractionDataOption,
  APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import type { GlyphBotsClient } from "../api/glyphbots";
import type { OpenSeaClient } from "../api/opensea";
import type { FollowUp } from "../discord/interactions";

export type OptionReader = {
  getBoolean: (name: string) => boolean | null;
  getInteger: (name: string) => number | null;
  getString: (name: string) => string | null;
};

export type CommandContext = {
  glyphbots: GlyphBotsClient;
  opensea: OpenSeaClient;
  options: OptionReader;
  /** Invoking user's id, or null in a context Discord did not give us one. */
  userId: string | null;
};

/** A handler returns the message that replaces the deferred placeholder. */
export type CommandHandler = (ctx: CommandContext) => Promise<FollowUp>;

const findOption = (
  options: APIApplicationCommandInteractionDataOption[],
  name: string
): APIApplicationCommandInteractionDataOption | undefined =>
  options.find((option) => option.name === name);

/**
 * Build the accessors over one interaction's options. None of the eight
 * commands uses a subcommand, so this deliberately does not walk into
 * subcommand groups; a nested option would read as absent rather than as the
 * wrong value.
 */
export const readOptions = (
  options: APIApplicationCommandInteractionDataOption[] = []
): OptionReader => ({
  getBoolean: (name) => {
    const option = findOption(options, name);
    return option?.type === ApplicationCommandOptionType.Boolean
      ? option.value
      : null;
  },
  // The `value` on an integer or string option widens to `string | number` in
  // the autocomplete-focused variants of the type, so both accessors check the
  // runtime type as well as the declared one.
  getInteger: (name) => {
    const option = findOption(options, name);
    if (option?.type !== ApplicationCommandOptionType.Integer) {
      return null;
    }
    return typeof option.value === "number" ? option.value : null;
  },
  getString: (name) => {
    const option = findOption(options, name);
    if (option?.type !== ApplicationCommandOptionType.String) {
      return null;
    }
    return typeof option.value === "string" ? option.value : null;
  },
});

/**
 * Pull the invoking user's id. In a guild it arrives under `member.user`, in a
 * DM under `user`. Only `/bot` ever read it, and only for the wallet lookup
 * that is not built here (`src/commands/bot.ts:181` at `c75d6a8`).
 */
export const readUserId = (
  interaction: Pick<
    APIChatInputApplicationCommandInteraction,
    "member" | "user"
  >
): string | null => interaction.member?.user.id ?? interaction.user?.id ?? null;
