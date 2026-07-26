# glyphbots-worker

The Cloudflare Worker that the three GlyphBots Discord bots are consolidating
onto. Phase 1 of [`plans/cloudflare-consolidation.md`](../plans/cloudflare-consolidation.md).

**What it does today:** a cron fires every five minutes, asks the GlyphBots API
for recently minted artifacts, and posts anything new into `#general` as an
embed. That is the whole feature set. No slash commands, no gateway, no OpenSea
feed; those are Phases 2 to 4.

`../src` is the Node bot and is untouched. It stays until Phase 5.

## Layout

```
src/
  index.ts                        Hono app, scheduled() handler, DO export
  config.ts                       channel ids and mint tuning (ids are constants)
  types.ts                        WorkerEnv bindings
  api/glyphbots.ts                GlyphBots client, built per invocation
  api/types.ts                    Artifact shapes
  channels/mints.ts               cursor logic + one poll
  discord/channel-poster.ts       POST /channels/{id}/messages
  durable-objects/feed-state.ts   FeedStateDO, holds the mint cursor
  durable-objects/mint-cursor-store.ts   the narrow read/write interface
  utils/logger.ts                 console logger
test/mints.test.ts                behavioral coverage ported from ../test
```

## Environment

Bindings arrive on `env` and are threaded down as arguments. Nothing reads
`process.env`, and no module captures configuration at import time. The Node
bot's `src/api/glyphbots.ts:17` does exactly that, which is why it needed
porting rather than copying: on Workers the module body runs before any binding
exists, so the capture would always be the fallback.

Secrets. **Set these yourself, they are not in this repo and no script here
writes them:**

```
wrangler secret put DISCORD_TOKEN     # Oracle's bot token
wrangler secret put DISCORD_APP_ID    # Oracle's application id
```

`DISCORD_APP_ID` is unused by Phase 1 code but is declared now because Phase 2's
interactions endpoint needs it and it belongs with the token.

Optional var: `GLYPHBOTS_API_URL`, which defaults to `https://glyphbots.com`.

## Bindings

- `FEED_STATE`, the `FeedStateDO` namespace. Durable Objects need Workers Paid.
- `GLYPHBOTS_KV`, reserved for per-user wallet state (`wallet:<userId>`) under
  decision 7 of the plan. Provisioned, bound, and read by nothing. Create it and
  paste the id into `wrangler.jsonc` before the first deploy:

  ```
  wrangler kv namespace create GLYPHBOTS_KV
  ```

## The mint cursor, and why it looks the way it does

Two fields in `FeedStateDO` storage: `lastMintedAtMs` and `postedArtifactIds`.

`lastMintedAtMs` is the maximum `mintedAt` across every mint handled, read off
the artifact itself and never from `Date.now()`, so a slow poll or a redeploy
cannot skip a window. Selection compares with `>=`, inclusive, so artifacts
sharing the boundary timestamp are re-admitted every poll on purpose.

`postedArtifactIds` (the last 100) is what actually rejects duplicates. That is
what makes the inclusive comparison harmless, and it also covers the API
reordering results or backfilling an older mint.

When a send fails, the timestamp is held back to sit at or below the oldest
failure so that mint is selectable again next tick, while the successful ids
stay in the set so they do not repost during the rewind.

A DO rather than KV because the tick is a read-modify-write and the DO input
gate makes it atomic. KV is eventually consistent with no compare-and-set, so
two overlapping ticks could clobber each other and drop a mint.

**The first tick after deploy posts nothing.** With no cursor in storage the
watcher seeds from the current newest mint and logs how many historical mints it
skipped. That is the cold-start path working, not a failure. The first real
post arrives with the next actual mint.

Above five new mints in one poll the burst guard posts the newest five
individually plus one summary line for the remainder, and advances the cursor
past all of them so the burst is never replayed.

## Commands

```
npm install
npm run typecheck
npm test
npm run dry-run       # wrangler deploy --dry-run, no auth, no deploy
npm run dev           # local wrangler dev
```

Deploying, `wrangler login`, and `wrangler secret put` are the operator's steps.

## Notes on dependencies

`discord.js` is not here and must not be added: `Client.login` opens a gateway
WebSocket through `ws` and `zlib-sync` and assumes a long-lived Node process.
`@discordjs/builders` is pure and bundles fine, so `EmbedBuilder` is reused
as-is. Sends go through `@discordjs/rest`, which handles 429s, and the cron path
is where waiting out a rate limit is cheap.
