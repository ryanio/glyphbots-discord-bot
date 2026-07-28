/**
 * GlyphBots Worker.
 *
 * Crons post new artifact mints into #general, a random collection item into
 * #gallery and OpenSea sales into #trading-floor, `POST /discord/interactions`
 * serves eight slash commands, and the gateway DO answers inline lookups. A
 * fourth cron checks whether the guild has gone quiet and, only if it has,
 * posts one item into #general.
 *
 * Bindings are read off `env` inside the handlers and threaded down as
 * explicit arguments. No module here captures the environment at import time.
 */

import { Hono } from "hono";
import { createDisplayNameResolver } from "./api/display-name";
import { createGlyphBotsClient } from "./api/glyphbots";
import { createOpenSeaClient } from "./api/opensea";
import { postGalleryItem } from "./channels/gallery";
import { pollMints } from "./channels/mints";
import { runIdleNudge } from "./channels/nudge";
import { pollSales } from "./channels/sales";
import { handlers } from "./commands";
import {
  GALLERY_CHANNEL_ID,
  LOOKUP_CHANNEL_IDS,
  MINTS_CHANNEL_ID,
  NUDGE_CHANNEL_ID,
  TRADING_FLOOR_CHANNEL_ID,
} from "./config";
import { createChannelPoster } from "./discord/channel-poster";
import {
  createIdleStateStore,
  createMintCursorStore,
  createSalesStateStore,
} from "./durable-objects/feed-stores";
import { createGatewayClient } from "./durable-objects/gateway-client";
import { admin } from "./routes/admin";
import { interactions } from "./routes/interactions";
import type { AppEnv, WorkerEnv } from "./types";
import { createLogger, getErrorMessage } from "./utils/logger";

export { FeedStateDO } from "./durable-objects/feed-state";
export { GatewayDO } from "./durable-objects/gateway";

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
    mintsChannelId: MINTS_CHANNEL_ID,
    galleryChannelId: GALLERY_CHANNEL_ID,
    nudgeChannelId: NUDGE_CHANNEL_ID,
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
      // The only OpenSea call the mint watcher makes, and only to put a name on
      // the minter instead of a hex address. One resolver per tick, so a batch
      // minted by one wallet costs one lookup.
      resolveName: createDisplayNameResolver(createOpenSeaClient(env)).resolve,
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

/** One `#gallery` tick. Most of them decide the guild is too awake to post. */
const runGallery = async (env: WorkerEnv): Promise<void> => {
  if (!env.DISCORD_TOKEN) {
    log.error("DISCORD_TOKEN is not set, gallery cannot post");
    return;
  }
  try {
    const outcome = await postGalleryItem({
      clients: {
        glyphbots: createGlyphBotsClient(env),
        opensea: createOpenSeaClient(env),
      },
      poster: createChannelPoster(env, GALLERY_CHANNEL_ID),
      store: createIdleStateStore(env),
    });
    log.info(`Gallery tick complete: ${outcome}`);
  } catch (error) {
    log.error(`Gallery tick failed: ${getErrorMessage(error)}`);
  }
};

/**
 * One idle check.
 *
 * Almost every one of these does nothing and logs `not-quiet`, which is the
 * feature working rather than a fault. See `src/channels/nudge.ts`.
 */
const runNudge = async (env: WorkerEnv): Promise<void> => {
  if (!env.DISCORD_TOKEN) {
    log.error("DISCORD_TOKEN is not set, the idle nudge cannot post");
    return;
  }

  try {
    const outcome = await runIdleNudge({
      clients: {
        glyphbots: createGlyphBotsClient(env),
        opensea: createOpenSeaClient(env),
      },
      poster: createChannelPoster(env, NUDGE_CHANNEL_ID),
      store: createIdleStateStore(env),
    });
    log.info(`Idle nudge: ${outcome}`);
  } catch (error) {
    log.error(`Idle nudge failed: ${getErrorMessage(error)}`);
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

/**
 * Cron expression to the work it runs, matched against `event.cron` in
 * `scheduled()`.
 *
 * Every key here must appear in `wrangler.jsonc`'s `triggers.crons` and the
 * other way round. `test/cron.test.ts` reads that file and asserts exactly
 * that, because these two lists are the only thing standing between a
 * six-hourly gallery post and a five-minutely one. The dispatch is exact-match
 * rather than "if something fired, do everything" for the same reason.
 *
 * The sales feed runs on the same five minute cadence as the mint watcher but
 * on a distinct expression, offset by two minutes. A second entry with the mint
 * watcher's exact expression would be indistinguishable here, since
 * `event.cron` is all the handler gets, and the offset also keeps the two ticks
 * off each other's subrequest budget. The reasoning is spelled out in
 * `wrangler.jsonc`.
 *
 * The nudge cron is hourly, and hourly is a check rather than a cadence: what
 * it posts is bounded by the 48 hour threshold and the 24 hour cooldown in
 * `src/channels/idle.ts`, not by how often it looks. Minute 23 keeps it clear
 * of both five-minute entries, which fire on minutes ending 0 or 5 and 2 or 7.
 */
export const CRON_JOBS: Record<string, (env: WorkerEnv) => Promise<void>[]> = {
  "*/5 * * * *": (env) => [runMintWatcher(env), pokeGateway(env)],
  "2-59/5 * * * *": (env) => [runSalesFeed(env)],
  "0 */6 * * *": (env) => [runGallery(env)],
  "23 * * * *": (env) => [runNudge(env)],
};

/**
 * Route a cron firing to its own work, and nothing else's.
 *
 * An unrecognised expression does nothing at all, loudly. It used to fall
 * through to the mint watcher, which is the worst available answer: add a
 * fifth cron and forget to add it here, or have Cloudflare normalise an
 * expression, and the mint watcher silently runs twice per period while the
 * job that was actually scheduled never runs at all. Nothing happening is
 * visible in `wrangler tail` within a period; a double mint tick is not
 * visible anywhere.
 */
export const dispatchCron = (cron: string, env: WorkerEnv): Promise<void>[] => {
  const job = CRON_JOBS[cron];

  if (!job) {
    log.error(
      `Unrecognized cron "${cron}", doing nothing. It is in wrangler.jsonc but not in CRON_JOBS (src/index.ts), so whatever it was meant to run is not running.`
    );
    return [];
  }

  return job(env);
};

export default {
  fetch: app.fetch,
  scheduled: (event, env, ctx) => {
    for (const work of dispatchCron(event.cron, env)) {
      ctx.waitUntil(work);
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
