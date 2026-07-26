/**
 * The defer inversion, which is the whole shape of HTTP interactions.
 *
 * On the gateway, `await interaction.deferReply()` was a REST call made in the
 * middle of a handler and execution simply continued in the same process. Over
 * HTTP there is no process to continue in: the deferral **is** the response
 * body. The endpoint returns `type: 5`
 * (`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`) inside Discord's 3 second ack
 * window, and the real work runs afterwards in `ctx.waitUntil`, finishing with
 * an edit of the placeholder message.
 *
 * If the handler returns without scheduling that continuation, the user sees
 * "The application did not respond". So does anything that throws inside the
 * continuation and is not caught. That is why `deferAndFollowUp` wraps the
 * entire async body: on any throw it logs and PATCHes an error embed, and if
 * even the PATCH fails it logs that too. There is no path that leaves the
 * spinner hanging silently.
 *
 * Deviation from Coral, noted deliberately: Coral's `deferAndFollowUp`
 * (`/Users/rg/dev/coral/packages/worker/src/routes/discord-community-bot-helpers.ts:155-186`)
 * POSTs a new follow-up message. These eight commands are all single-message
 * replies, so `PATCH .../messages/@original` is the closer analogue of the
 * `editReply()` they used to call and produces one message rather than a
 * placeholder plus a follow-up.
 */

import {
  type APIInteractionResponseDeferredChannelMessageWithSource,
  InteractionResponseType,
  type RESTPatchAPIInteractionOriginalResponseJSONBody,
} from "discord-api-types/v10";
import { COLORS } from "../config";
import { createLogger, getErrorMessage } from "../utils/logger";

const log = createLogger("Interactions");

const DISCORD_API = "https://discord.com/api/v10";

/** Body of the message that replaces the deferred placeholder. */
export type FollowUp = RESTPatchAPIInteractionOriginalResponseJSONBody;

/** The Worker's `ctx.waitUntil`, narrowed to what this module uses. */
export type WaitUntil = (promise: Promise<unknown>) => void;

export type DeferAndFollowUpArgs = {
  /** Discord application id. Part of the follow-up webhook path. */
  appId: string;
  /** Interaction token. Valid for 15 minutes, and is its own credential. */
  interactionToken: string;
  /** Command name, for log lines only. */
  commandName: string;
  waitUntil: WaitUntil;
  /** The real work. Anything it throws becomes the error follow-up. */
  build: () => Promise<FollowUp>;
  /** Swappable for tests. Defaults to the live PATCH. */
  editOriginal?: EditOriginal;
};

export type EditOriginal = (
  appId: string,
  interactionToken: string,
  body: FollowUp
) => Promise<boolean>;

/**
 * `PATCH /webhooks/{application_id}/{interaction_token}/messages/@original`.
 *
 * No `Authorization` header: interaction follow-up routes are webhook routes
 * and the interaction token is the credential. Sending a bot token here is not
 * an error, it is just unnecessary, and leaving it out keeps the bot token out
 * of the interaction path entirely.
 *
 * Returns false on any non-2xx rather than throwing, so the caller can decide
 * whether it still has a fallback left to try.
 */
export const editOriginalResponse: EditOriginal = async (
  appId,
  interactionToken,
  body
) => {
  // Built by hand rather than through `Routes.webhookMessage`, which
  // percent-encodes the message id and turns `@original` into `%40original`.
  // Discord accepts both, but the literal form is the one in the docs and the
  // one that shows up readable in a log line.
  const url = `${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`;

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log.error(
        `Follow-up PATCH failed: ${response.status} ${text.slice(0, 200)}`
      );
      return false;
    }

    return true;
  } catch (error) {
    log.error(`Follow-up PATCH threw: ${getErrorMessage(error)}`);
    return false;
  }
};

/** The message a user gets when a handler blew up. Never a bare spinner. */
export const errorFollowUp = (commandName: string): FollowUp => ({
  embeds: [
    {
      color: COLORS.error,
      title: "❌ Something went wrong",
      description: `\`/${commandName}\` could not be completed. Please try again in a moment.`,
    },
  ],
});

/**
 * Return the deferral immediately, run `build()` afterwards, and edit the
 * placeholder with whatever it produced. Every one of the eight commands does
 * network I/O, so every one of them goes through this.
 *
 * The return value is the HTTP response body for the interaction, and it is
 * produced synchronously. Nothing is awaited before returning it.
 */
export const deferAndFollowUp = (
  args: DeferAndFollowUpArgs
): APIInteractionResponseDeferredChannelMessageWithSource => {
  const {
    appId,
    interactionToken,
    commandName,
    waitUntil,
    build,
    editOriginal = editOriginalResponse,
  } = args;

  waitUntil(
    (async () => {
      let followUp: FollowUp;

      try {
        followUp = await build();
      } catch (error) {
        log.error(`/${commandName} failed: ${getErrorMessage(error)}`);
        followUp = errorFollowUp(commandName);
      }

      const ok = await editOriginal(appId, interactionToken, followUp);

      if (!ok) {
        log.error(
          `/${commandName} could not deliver its follow-up, the user is left with the deferred placeholder`
        );
      }
    })()
  );

  return { type: InteractionResponseType.DeferredChannelMessageWithSource };
};
