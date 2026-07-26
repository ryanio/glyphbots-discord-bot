/**
 * GlyphBots Worker.
 *
 * Phase 1 of plans/cloudflare-consolidation.md: a cron posts new artifact
 * mints into #general, and nothing else. The interactions endpoint arrives in
 * Phase 2, the gateway DO in Phase 3, the OpenSea feed in Phase 4.
 *
 * Bindings are read off `env` inside the handlers and threaded down as
 * explicit arguments. No module here captures the environment at import time.
 */

import { Hono } from "hono";
import { createGlyphBotsClient } from "./api/glyphbots";
import { pollMints } from "./channels/mints";
import { MINTS_CHANNEL_ID } from "./config";
import { createChannelPoster } from "./discord/channel-poster";
import { createMintCursorStore } from "./durable-objects/mint-cursor-store";
import type { AppEnv, WorkerEnv } from "./types";
import { createLogger, getErrorMessage } from "./utils/logger";

export { FeedStateDO } from "./durable-objects/feed-state";

const log = createLogger("WORKER");

const app = new Hono<AppEnv>();

app.get("/health", (c) =>
  c.json({
    ok: true,
    phase: 1,
    mintsChannelId: MINTS_CHANNEL_ID,
  })
);

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

export default {
  fetch: app.fetch,
  scheduled: (_event, env, ctx) => {
    ctx.waitUntil(runMintWatcher(env));
  },
} satisfies ExportedHandler<WorkerEnv>;
