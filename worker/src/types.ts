/**
 * Worker bindings and shared app types.
 *
 * Nothing in this package reads `process.env`. Every value arrives on the
 * `env` object handed to `fetch()` / `scheduled()` and is threaded down
 * explicitly, so a module can never capture a stale (or empty) config at
 * import time the way `src/api/glyphbots.ts:17` does on Node.
 */

export type WorkerEnv = {
  /** Durable Object namespace holding the mint cursor. */
  FEED_STATE: DurableObjectNamespace;
  /**
   * Reserved for per-user wallet state (`wallet:<userId>`), decision 7 in
   * plans/cloudflare-consolidation.md. Provisioned and bound, read by nothing
   * in Phase 1. Do not start writing to it without that decision being made.
   */
  GLYPHBOTS_KV: KVNamespace;
  /** Discord bot token. `wrangler secret put DISCORD_TOKEN`. */
  DISCORD_TOKEN: string;
  /** Discord application id. `wrangler secret put DISCORD_APP_ID`. */
  DISCORD_APP_ID: string;
  /**
   * Ed25519 public key from the Discord developer portal, used to verify every
   * request to `/discord/interactions`. `wrangler secret put
   * DISCORD_PUBLIC_KEY`. Without it the endpoint answers 503 rather than
   * accepting unverified requests.
   */
  DISCORD_PUBLIC_KEY?: string;
  /**
   * OpenSea API key. Optional: the public tier works at a lower rate limit,
   * which is what the Node bot fell back to whenever the variable was unset.
   */
  OPENSEA_API_TOKEN?: string;
  /** Override for the GlyphBots API origin. Defaults to production. */
  GLYPHBOTS_API_URL?: string;
};

/** Hono app environment. */
export type AppEnv = {
  Bindings: WorkerEnv;
};
