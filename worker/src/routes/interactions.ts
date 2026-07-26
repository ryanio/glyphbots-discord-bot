/**
 * `POST /discord/interactions`, the Ed25519-verified endpoint.
 *
 * Order matters and is not negotiable:
 *
 * 1. Read the **raw** body as text. Never `c.req.json()` first: the signature
 *    covers the exact bytes Discord sent, and re-serializing changes them.
 * 2. Verify. A failure is a bare 401, no body worth parsing.
 * 3. `PING` (type 1) answers `PONG` (type 1). This is what Discord probes when
 *    the Interactions Endpoint URL is saved in the developer portal, and the
 *    URL is rejected outright if it is wrong, so this branch runs before any
 *    routing or client construction.
 * 4. Everything else defers, and the work happens in `ctx.waitUntil`.
 *
 * Discord also probes with a deliberately *invalid* signature and expects a
 * 401, so verification must fail closed rather than falling through on a
 * malformed header.
 */

import type {
  APIChatInputApplicationCommandInteraction,
  APIInteraction,
} from "discord-api-types/v10";
import { InteractionResponseType, InteractionType } from "discord-api-types/v10";
import { Hono } from "hono";
import { createGlyphBotsClient } from "../api/glyphbots";
import { createOpenSeaClient } from "../api/opensea";
import { getHandler } from "../commands";
import { readOptions, readUserId } from "../commands/context";
import { deferAndFollowUp } from "../discord/interactions";
import { verifySignature } from "../discord/verify";
import type { AppEnv } from "../types";
import { createLogger } from "../utils/logger";

const log = createLogger("Interactions");

const UNAUTHORIZED = 401;
const BAD_REQUEST = 400;
const NOT_CONFIGURED = 503;

const parseInteraction = (body: string): APIInteraction | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { type?: unknown }).type === "number"
    ) {
      return parsed as APIInteraction;
    }
    return null;
  } catch {
    return null;
  }
};

export const interactions = new Hono<AppEnv>();

interactions.post("/interactions", async (c) => {
  const publicKey = c.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    log.error("DISCORD_PUBLIC_KEY is not set, cannot verify interactions");
    return c.json({ error: "not_configured" }, NOT_CONFIGURED);
  }

  const signature = c.req.header("x-signature-ed25519") ?? "";
  const timestamp = c.req.header("x-signature-timestamp") ?? "";
  const body = await c.req.text();

  const valid = await verifySignature(publicKey, signature, timestamp, body);
  if (!valid) {
    log.warn("Rejected an interaction with an invalid signature");
    return c.json({ error: "invalid_signature" }, UNAUTHORIZED);
  }

  const interaction = parseInteraction(body);
  if (!interaction) {
    return c.json({ error: "invalid_payload" }, BAD_REQUEST);
  }

  // Discord's endpoint-URL probe. Answer before anything else can fail.
  if (interaction.type === InteractionType.Ping) {
    log.info("PING received, replying PONG");
    return c.json({ type: InteractionResponseType.Pong });
  }

  if (interaction.type !== InteractionType.ApplicationCommand) {
    // Every in-scope button is `ButtonStyle.Link`, so nothing routes back.
    log.warn(`Unhandled interaction type ${interaction.type}`);
    return c.json({ error: "unsupported_interaction" }, BAD_REQUEST);
  }

  const command = interaction as APIChatInputApplicationCommandInteraction;
  const name = command.data.name;
  const handler = getHandler(name);

  if (!handler) {
    log.warn(`No handler registered for /${name}`);
    return c.json({ error: "unknown_command" }, BAD_REQUEST);
  }

  const appId = c.env.DISCORD_APP_ID || command.application_id;

  log.info(`/${name} invoked (interaction ${command.id})`);

  return c.json(
    deferAndFollowUp({
      appId,
      interactionToken: command.token,
      commandName: name,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      build: () =>
        handler({
          glyphbots: createGlyphBotsClient(c.env),
          opensea: createOpenSeaClient(c.env),
          options: readOptions(command.data.options),
          userId: readUserId(command),
        }),
    })
  );
});
