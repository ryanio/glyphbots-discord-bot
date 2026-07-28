/**
 * One MESSAGE_CREATE, from gate to reply.
 *
 * Everything here is injected so the whole path can be driven from a test
 * without a gateway, a Durable Object or a network: the gates are pure, the
 * clients are interfaces, and the reply is a `send` callback.
 *
 * Gate order matters and is deliberate, cheapest and most-rejecting first:
 *
 *   1. author is a bot (including this bot itself) -> drop. Without this the
 *      bot answers its own embeds and loops forever.
 *   2. no guild id -> drop. That is a DM, which is out of scope.
 *   3. guild is not the GlyphBots guild -> drop.
 *   4. channel is not `#general` or `#show-and-tell` -> drop.
 *   5. nothing in the text parses as a lookup -> drop.
 *   6. the channel is over its rate limit -> drop, logged.
 *
 * Only after all six does any network call happen. Steps 1 to 5 are free, and
 * step 5 sits before step 6 on purpose: ordinary conversation must not consume
 * the channel's lookup budget, or a busy `#general` would rate-limit the first
 * real lookup of the minute.
 */

import type { APIEmbed } from "discord-api-types/v10";
import { createDisplayNameResolver } from "../api/display-name";
import {
  GUILD_ID,
  LOOKUP_CHANNEL_IDS,
  MAX_EMBEDS_PER_MESSAGE,
} from "../config";
import { createLogger, getErrorMessage } from "../utils/logger";
import { buildLookupEmbed, type LookupClients } from "./embeds";
import { type LookupMatch, parseLookups } from "./matcher";
import type { RateLimiter } from "./rate-limit";

const log = createLogger("Lookups");

/** The slice of a Discord MESSAGE_CREATE payload this path reads. */
export type LookupMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: { id: string; bot?: boolean; username?: string };
};

export type LookupDeps = {
  clients: LookupClients;
  limiter: RateLimiter;
  /** Posts the reply. One call per handled message, never more. */
  send: (channelId: string, body: LookupReply) => Promise<void>;
  /** This bot's own user id, once READY has arrived. */
  selfUserId?: string | null;
  /** Injected in tests. */
  now?: () => number;
  parse?: (content: string) => LookupMatch[];
};

export type LookupReply = {
  embeds: APIEmbed[];
  message_reference: { message_id: string; fail_if_not_exists: boolean };
};

export const isLookupChannel = (channelId: string): boolean =>
  LOOKUP_CHANNEL_IDS.includes(channelId);

/** Why a message was not answered. `"answered"` means embeds went out. */
export type LookupOutcome =
  | "answered"
  | "bot-author"
  | "no-guild"
  | "wrong-guild"
  | "channel-not-allowed"
  | "no-match"
  | "rate-limited"
  | "no-embeds"
  | "send-failed";

export const handleLookupMessage = async (
  message: LookupMessage,
  deps: LookupDeps
): Promise<LookupOutcome> => {
  if (message.author.bot === true || message.author.id === deps.selfUserId) {
    return "bot-author";
  }
  if (!message.guild_id) {
    return "no-guild";
  }
  if (message.guild_id !== GUILD_ID) {
    return "wrong-guild";
  }
  if (!isLookupChannel(message.channel_id)) {
    return "channel-not-allowed";
  }

  const parse =
    deps.parse ??
    ((content: string) =>
      parseLookups(content, { limit: MAX_EMBEDS_PER_MESSAGE }));
  const matches = parse(message.content);

  if (matches.length === 0) {
    return "no-match";
  }

  const decision = deps.limiter.check(message.channel_id, deps.now?.());
  if (!decision.allowed) {
    log.warn(
      `Rate-limited (${decision.reason}) channel=${message.channel_id} matches=${matches.length}`
    );
    return "rate-limited";
  }

  // One owner-name cache for the whole reply. Six `b#` lookups of bots held by
  // the same wallet then cost one account call between them rather than six.
  const clients: LookupClients = {
    ...deps.clients,
    names:
      deps.clients.names ?? createDisplayNameResolver(deps.clients.opensea),
  };

  const embeds: APIEmbed[] = [];
  for (const match of matches.slice(0, MAX_EMBEDS_PER_MESSAGE)) {
    try {
      const embed = await buildLookupEmbed(match, clients);
      if (embed) {
        embeds.push(embed);
      }
    } catch (error) {
      // One bad lookup must not swallow the others. The Node bot wrapped the
      // whole message in a single try and answered nothing when any single
      // embed threw (`discord-nft-embed-bot/src/index.ts:483-489`).
      log.error(`Lookup embed failed: ${getErrorMessage(error)}`);
    }
  }

  if (embeds.length === 0) {
    return "no-embeds";
  }

  try {
    await deps.send(message.channel_id, {
      embeds,
      // Reply to the triggering message rather than posting loose, matching
      // `message.reply()` on the Node bot. `fail_if_not_exists: false` so a
      // deleted trigger still posts instead of erroring.
      message_reference: {
        message_id: message.id,
        fail_if_not_exists: false,
      },
    });
  } catch (error) {
    log.error(`Lookup reply failed: ${getErrorMessage(error)}`);
    return "send-failed";
  }

  log.info(
    `Answered ${embeds.length} lookup(s) in channel=${message.channel_id}`
  );
  return "answered";
};
