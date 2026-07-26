# glyphbots-worker

The Cloudflare Worker that the three GlyphBots Discord bots are consolidating
onto. Phases 1 and 2 of [`plans/cloudflare-consolidation.md`](../plans/cloudflare-consolidation.md).

**What it does today:**

- A cron fires every five minutes, asks the GlyphBots API for recently minted
  artifacts, and posts anything new into `#general` as an embed.
- `POST /discord/interactions` verifies Ed25519 and serves eight slash
  commands: `/bot`, `/artifact`, `/floor`, `/sales`, `/listings`, `/owner`,
  `/rarity`, `/activity`.

No gateway and no OpenSea feed. Those are Phases 3 and 4.

`../src` is the Node bot and is untouched. It stays until Phase 5.

## Layout

```
src/
  index.ts                        Hono app, scheduled() handler, DO export
  config.ts                       ids, contracts, colors, mint tuning
  types.ts                        WorkerEnv bindings
  api/glyphbots.ts                GlyphBots client, built per invocation
  api/opensea.ts                  OpenSea client, built per invocation
  api/types.ts                    Artifact, Bot and OpenSea shapes
  channels/mints.ts               cursor logic + one poll
  commands/                       the eight handlers
    context.ts                    what a handler is handed, option reading
    definitions.ts                the eight registration bodies
    format.ts                     shared ETH / number / time-ago formatting
    index.ts                      name -> handler map
  discord/buttons.ts              link button rows
  discord/channel-poster.ts       POST /channels/{id}/messages
  discord/embeds.ts               error and single-embed reply shorthands
  discord/interactions.ts         the defer helper and the follow-up PATCH
  discord/verify.ts               Ed25519 verification via WebCrypto
  durable-objects/feed-state.ts   FeedStateDO, holds the mint cursor
  durable-objects/mint-cursor-store.ts   the narrow read/write interface
  routes/interactions.ts          POST /discord/interactions
  utils/logger.ts                 console logger
scripts/register-commands.ts      operator-run guild registration (see below)
test/mints.test.ts                mint watcher coverage, ported from ../test
test/interactions.test.ts         signature, PING/PONG, defer inversion, wiring
test/commands.test.ts             per-command response shaping
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
wrangler secret put DISCORD_TOKEN        # Oracle's bot token, mint watcher
wrangler secret put DISCORD_APP_ID       # Oracle's application id
wrangler secret put DISCORD_PUBLIC_KEY   # Ed25519 key from the developer portal
wrangler secret put OPENSEA_API_TOKEN    # optional, see below
```

Without `DISCORD_PUBLIC_KEY` the interactions endpoint answers 503 rather than
accepting anything it cannot verify. `OPENSEA_API_TOKEN` is genuinely optional:
the public tier serves the same endpoints at a much lower rate limit, which is
what the Node bot fell back to whenever the variable was unset.

Note that the follow-up PATCH does not use the bot token. Interaction webhook
routes authenticate with the interaction token itself, so the bot token never
enters the slash command path.

Optional var: `GLYPHBOTS_API_URL`, which defaults to `https://www.glyphbots.com`.
The `www` host is deliberate. The apex 307s on every API path, and on Workers
each redirect costs a subrequest.

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

## Slash commands

Eight, and only eight. All of them do network I/O, so all of them defer.

### The defer inversion

This is the one thing to understand before changing a handler. On the gateway
`await interaction.deferReply()` was a call made mid-function and execution
continued in the same process. Over HTTP the deferral **is** the response body:
the endpoint returns `type: 5` inside Discord's 3 second ack window and the
real work runs afterwards in `ctx.waitUntil`, finishing with

```
PATCH /webhooks/{application_id}/{interaction_token}/messages/@original
```

`deferAndFollowUp` in `src/discord/interactions.ts` is the only place that
shape exists. A handler is just `(ctx) => Promise<FollowUp>`; it never sees the
interaction token, never defers, and never patches. If it throws, the helper
catches, logs, and patches an error embed, because the alternative a user sees
is a spinner that never resolves.

`PATCH @original` rather than Coral's `POST /webhooks/{app}/{token}`: every one
of these eight is a single-message reply, so editing the placeholder is the
closer analogue of the `editReply()` they used to call.

### OpenSea images are SVG, and Discord renders nothing for them

Verified live: `image_url` for `0xb6c2...5075` is `image/svg+xml`. Every embed
image and thumbnail in this package comes from `getBotPngUrl`, which builds
`https://www.glyphbots.com/bots/pngs/<id>.png`.

This is enforced by the type rather than by review: the OpenSea shapes in
`src/api/types.ts` deliberately omit `image_url` and `display_image_url`, so
carrying one into an embed does not compile. `/artifact` does set an image, but
from `artifact.imageUrl` on the GlyphBots API, which is JPEG or PNG.

### Wallet linking is not built

`src/commands/bot.ts:181` on the Node bot called `getUserWallet` to bias
`/bot random:true` toward bots the caller owns. Decision 7 of the plan reserves
a KV namespace for per-user state and says to build nothing, so **that variant
is removed**, not stubbed. `random:true` picks uniformly across the supply,
which is exactly what the old handler did whenever no wallet was linked, and
the option's description no longer mentions wallets. `/bot user:<address-or-name>`
still gives a random bot from a specific account and needs no stored state.

## Registering the commands

**Operator step. Run it by hand, once, after this is deployed and the
Interactions Endpoint URL is saved in the developer portal.**

```
DISCORD_TOKEN=... DISCORD_APP_ID=... npx tsx scripts/register-commands.ts
```

Add `--dry-run` to print the payload and exit without calling Discord.

There is deliberately no npm script for it. It mutates the live guild, and a
named script is one `npm run` chain away from being executed by accident.

It is a single `PUT /applications/{app_id}/guilds/{guild_id}/commands`, which
is a full replacement. Seventeen commands are registered today; this writes
eight and the other nine (`arena`, `help`, `info`, `mybots`, `random`,
`spotlight`, `stats`, `tips`, `wallet`) disappear in the same call. There is no
intermediate state where a user sees a half-registered list.

Sequencing matters: deploy first, save the endpoint URL second, register third.
Discord probes the URL with a PING and refuses to save one that does not verify
signatures correctly, and registering commands that no endpoint answers is how
you get "The application did not respond" in front of users.

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
`@discordjs/builders` is pure and bundles fine, so `EmbedBuilder`,
`ButtonBuilder` and `ActionRowBuilder` are reused as-is. Two small differences
from the discord.js versions the handlers were written against: `setColor`
takes a number rather than a `"#rrggbb"` string, and `setEmoji` takes
`{ name: "🤖" }` rather than a bare string. Both are handled in `src/config.ts`
and `src/discord/buttons.ts`.

Sends from the cron go through `@discordjs/rest`, which handles 429s, and the
cron path is where waiting out a rate limit is cheap. The interaction follow-up
does not: it is a single PATCH on a 15 minute token, and a retry that outlives
the request is worse than a failure that gets logged.

Ed25519 verification uses WebCrypto, which Workers exposes natively. No
dependency, no Node crypto shim, no `node:` imports anywhere in `src/`.
