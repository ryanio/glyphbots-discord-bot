/**
 * GlyphBots Worker.
 *
 * Phases 1 to 4 of plans/cloudflare-consolidation.md: crons post new artifact
 * mints into #general, a random collection item into #gallery and OpenSea
 * sales into #trading-floor, `POST /discord/interactions` serves eight slash
 * commands, and the gateway DO answers inline lookups.
 *
 * Bindings are read off `env` inside the handlers and threaded down as
 * explicit arguments. No module here captures the environment at import time.
 */

import { Hono } from "hono";
import { createGlyphBotsClient } from "./api/glyphbots";
import { createOpenSeaClient } from "./api/opensea";
import { postGalleryItem } from "./channels/gallery";
import { pollMints } from "./channels/mints";
import { pollSales } from "./channels/sales";
import { handlers } from "./commands";
import {
  GALLERY_CHANNEL_ID,
  LOOKUP_CHANNEL_IDS,
  MINTS_CHANNEL_ID,
  TRADING_FLOOR_CHANNEL_ID,
} from "./config";
import { createChannelPoster } from "./discord/channel-poster";
import { createGatewayClient } from "./durable-objects/gateway-client";
import { createMintCursorStore } from "./durable-objects/mint-cursor-store";
import { createSalesStateStore } from "./durable-objects/sales-state-store";
import { admin } from "./routes/admin";
import { interactions } from "./routes/interactions";
import type { AppEnv, WorkerEnv } from "./types";
import { createLogger, getErrorMessage } from "./utils/logger";

export { FeedStateDO } from "./durable-objects/feed-state";
export { GatewayDO } from "./durable-objects/gateway";

/**
 * Cron expressions, matched against `event.cron` in `scheduled()`.
 *
 * All three entries live in `wrangler.jsonc` and the dispatch is exact-match
 * rather than "if it fired, do everything": crons that run each other's work is
 * how a six-hourly gallery post turns into one every five minutes.
 *
 * The sales feed runs on the same five minute cadence as the mint watcher but
 * on a distinct expression, offset by two minutes. A second entry with the mint
 * watcher's exact expression would be indistinguishable here, since
 * `event.cron` is all the handler gets, and the offset also keeps the two ticks
 * off each other's subrequest budget. The reasoning is spelled out in
 * `wrangler.jsonc`.
 */
const MINTS_CRON = "*/5 * * * *";
const SALES_CRON = "2-59/5 * * * *";
const GALLERY_CRON = "0 */6 * * *";

const log = createLogger("WORKER");

const app = new Hono<AppEnv>();

/**
 * Liveness plus the gateway's own view of itself. The gateway block is
 * best-effort: `/health` must answer even when the DO is unreachable, because
 * a health check that fails for the wrong reason is worse than no health
 * check.
 */
app.get("/health", async (c) => {
  let gateway: unknown = null;
  try {
    gateway = await createGatewayClient(c.env).call("status");
  } catch (error) {
    gateway = { error: getErrorMessage(error) };
  }

  return c.json({
    ok: true,
    phase: 4,
    mintsChannelId: MINTS_CHANNEL_ID,
    galleryChannelId: GALLERY_CHANNEL_ID,
    tradingFloorChannelId: TRADING_FLOOR_CHANNEL_ID,
    lookupChannelIds: LOOKUP_CHANNEL_IDS,
    commands: Object.keys(handlers).sort(),
    gateway,
  });
});

// Discord posts here. The route verifies Ed25519 itself; nothing in front of
// it may consume the body, because the signature covers the raw bytes.
app.route("/discord", interactions);

// Operator-only. Every route under here checks ADMIN_TOKEN first.
app.route("/_admin", admin);

app.all("*", (c) => c.json({ error: "not_found" }, 404));

/** One mint tick. Env-derived collaborators are built here and passed down. */
const runMintWatcher = async (env: WorkerEnv): Promise<void> => {
  if (!env.DISCORD_TOKEN) {
    log.error("DISCORD_TOKEN is not set, mint watcher cannot post");
    return;
  }

  try {
    const posted = await pollMints({
      api: createGlyphBotsClient(env),
      poster: createChannelPoster(env, MINTS_CHANNEL_ID),
      store: createMintCursorStore(env),
    });
    log.info(`Mint tick complete, posted ${posted}`);
  } catch (error) {
    log.error(`Mint poll failed: ${getErrorMessage(error)}`);
  }
};

/**
 * Gateway watchdog, riding the five minute mint cron rather than a cron of its
 * own.
 *
 * This is what brings the socket up after a deploy: a fresh DO is `idle`, the
 * first tick opens it, and every tick afterwards is a no-op unless the socket
 * has gone. Coral runs the same poke from an Inngest cron every minute
 * (`community-bot-discord-watchdog.ts`). Five minutes is the recovery ceiling
 * here, and it is only reached in the case the DO's own alarm-driven backoff
 * has also failed, which is a case worth a slower recovery rather than a
 * second cron entry.
 */
const pokeGateway = async (env: WorkerEnv): Promise<void> => {
  if (!env.DISCORD_TOKEN) {
    log.error("DISCORD_TOKEN is not set, not starting the gateway");
    return;
  }
  try {
    const status = await createGatewayClient(env).call("health-tick");
    log.info(`Gateway watchdog: ${JSON.stringify(status)}`);
  } catch (error) {
    log.error(`Gateway watchdog failed: ${getErrorMessage(error)}`);
  }
};

/** One `#gallery` tick. */
const runGallery = async (env: WorkerEnv): Promise<void> => {
  if (!env.DISCORD_TOKEN) {
    log.error("DISCORD_TOKEN is not set, gallery cannot post");
    return;
  }
  try {
    await postGalleryItem({
      clients: {
        glyphbots: createGlyphBotsClient(env),
        opensea: createOpenSeaClient(env),
      },
      poster: createChannelPoster(env, GALLERY_CHANNEL_ID),
    });
  } catch (error) {
    log.error(`Gallery tick failed: ${getErrorMessage(error)}`);
  }
};

/** One OpenSea sales tick into `#trading-floor`. */
const runSalesFeed = async (env: WorkerEnv): Promise<void> => {
  if (!env.DISCORD_TOKEN) {
    log.error("DISCORD_TOKEN is not set, the sales feed cannot post");
    return;
  }

  try {
    const sent = await pollSales({
      opensea: createOpenSeaClient(env),
      glyphbots: createGlyphBotsClient(env),
      poster: createChannelPoster(env, TRADING_FLOOR_CHANNEL_ID),
      store: createSalesStateStore(env),
    });
    log.info(`Sales tick complete, sent ${sent}`);
  } catch (error) {
    log.error(`Sales tick failed: ${getErrorMessage(error)}`);
  }
};

/** Route a cron firing to its own work, and nothing else's. */
export const dispatchCron = (cron: string, env: WorkerEnv): Promise<void>[] => {
  if (cron === GALLERY_CRON) {
    return [runGallery(env)];
  }
  if (cron === SALES_CRON) {
    return [runSalesFeed(env)];
  }
  if (cron === MINTS_CRON) {
    return [runMintWatcher(env), pokeGateway(env)];
  }
  log.warn(`Unrecognized cron "${cron}", running the mint tick as a fallback`);
  return [runMintWatcher(env), pokeGateway(env)];
};

export default {
  fetch: app.fetch,
  scheduled: (event, env, ctx) => {
    for (const work of dispatchCron(event.cron, env)) {
      ctx.waitUntil(work);
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
