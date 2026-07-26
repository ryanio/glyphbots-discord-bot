/**
 * `/_admin/gateway/*`, the operator's control surface for the gateway socket.
 *
 * Mirrors Coral's
 * `/Users/rg/dev/coral/packages/worker/src/routes/community-bot-discord.ts`:
 * connect, status, reconnect, plus the `health-tick` the watchdog calls.
 *
 * Auth is a bearer token compared against the `ADMIN_TOKEN` secret. Two rules
 * that matter more than the mechanism:
 *
 * - an **unset** `ADMIN_TOKEN` is a 503, never an open door. Getting that
 *   backwards puts a "reconnect the bot" button on the public internet.
 * - the comparison is length-checked and constant-time-ish. It is a shared
 *   secret on a route nobody hammers, so this is belt and braces, but an early
 *   `!==` return leaks length through timing for free.
 */

import { Hono } from "hono";
import {
  createGatewayClient,
  type GatewayCommand,
} from "../durable-objects/gateway-client";
import type { AppEnv } from "../types";
import { createLogger, getErrorMessage } from "../utils/logger";

const log = createLogger("Admin");

const UNAUTHORIZED = 401;
const NOT_CONFIGURED = 503;
const UPSTREAM_ERROR = 502;

/** Compare without an early exit on the first differing byte. */
const secretEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time compare
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const admin = new Hono<AppEnv>();

admin.use("/gateway/*", async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) {
    log.error("ADMIN_TOKEN is not set, refusing every admin request");
    return c.json({ error: "not_configured" }, NOT_CONFIGURED);
  }

  const header = c.req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!secretEquals(presented, expected)) {
    log.warn("Rejected an admin request with a bad token");
    return c.json({ error: "unauthorized" }, UNAUTHORIZED);
  }

  await next();
});

const route = (path: string, command: GatewayCommand): void => {
  admin.all(`/gateway/${path}`, async (c) => {
    try {
      const result = await createGatewayClient(c.env).call(command);
      return c.json({ ok: true, command, result });
    } catch (error) {
      log.error(`Gateway ${command} failed: ${getErrorMessage(error)}`);
      return c.json(
        { ok: false, command, error: getErrorMessage(error) },
        UPSTREAM_ERROR
      );
    }
  });
};

route("connect", "connect");
route("status", "status");
route("reconnect", "reconnect");
route("health-tick", "health-tick");
