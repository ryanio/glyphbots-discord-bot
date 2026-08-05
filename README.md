# glyphbots-discord-bot

The GlyphBots Discord bot. It runs as a single Cloudflare Worker, live at
`https://glyphbots-worker.ryan-2e8.workers.dev`, serving one Discord
application in one guild.

All of it is in [`worker/`](worker/).

This repo used to hold a Node bot that ran on a DigitalOcean droplet under PM2,
alongside two others. That droplet is gone and all three are now this one
Worker. The Node source was deleted in the same change that wrote this README;
it is in the git history at `d668f57` (under `legacy/`) and before that at
`4e89b7d` (under `src/`) if any of it is ever wanted again.

## Repository layout

```
worker/    the live Cloudflare Worker (see worker/README.md)
plans/     the consolidation plan and its execution tracker
.github/   the deploy workflow
```

## What the bot does

### Slash commands

Eight, registered to the guild.

| Command | What it does |
|---|---|
| `/bot id:<n>` or `/bot random` or `/bot user:<name>` | A GlyphBot with its traits and OpenSea data |
| `/artifact id:<n>` or `/artifact random` | An artifact with its details |
| `/floor` | Collection stats and floor price |
| `/sales` | Recent GlyphBots sales on OpenSea, each with the bot's rarity rank |
| `/listings` | The cheapest GlyphBots currently listed |
| `/owner id:<n>` | Who owns a given bot |
| `/rarity id:<n>` | A bot's rarity rank and traits |
| `/activity id:<n>` | Recent activity for one bot, under its rarity rank |

They arrive over HTTP at `POST /discord/interactions`, which verifies Discord's
Ed25519 signature, defers, and sends the real reply as a follow-up. The follow-up
authenticates with the interaction token, so the bot token never enters the slash
command path.

Registration is deliberately not automatic. It mutates the live guild, so it is
an operator step: `npx tsx scripts/register-commands.ts` from `worker/`.

### Inline lookups

Type `b#123` for a bot, `a#123` for an artifact, or `#username` for an OpenSea
account, anywhere in a message. The bot replies with an embed per match. A bare
`#123` means a bot. `#random` (or `#rand`, or `#?`) picks one at random.

This works in `#general` and `#show-and-tell` only, and never in DMs. Bot token
ids run 1 to 11,111 and artifact ids up to 100,000; anything outside those ranges
is ignored, as are channel mentions, role mentions and custom emoji. Six matches
per message maximum, which is Discord's own embed limit, and duplicates in one
message collapse to a single lookup. Per channel there is a three second cooldown
and a cap of ten lookups a minute.

A Durable Object holds one WebSocket to the Discord gateway to receive these
messages. It cannot hibernate (an outbound socket is not eligible), so it stays
resident.

### Mint feed

Every five minutes the Worker asks the GlyphBots API for recent mints and posts
anything new into `#general`. The cursor tracks the newest `mintedAt` it has
handled plus the last 100 posted ids, so a redeploy or a slow poll does not skip
or repeat. On a cold start it seeds from the current newest mint and posts
nothing, which is why the first tick after a fresh deploy looks quiet.

### Sales feed

Every five minutes the Worker sweeps OpenSea for sales and posts them into
`#trading-floor`. It covers both collections: GlyphBots and artifacts are two
OpenSea collections with two contracts, so a tick asks for each by slug and
merges them into one timeline.

A bot sale shows its rarity rank next to the price. An artifact shows its title
and art from the GlyphBots API, a link to the bot it came from, and a quantity
when more than one copy changed hands. One buyer taking several items inside a
60 second window is one grouped message rather than several, and bots and
artifacts group separately so a message is always about one collection.

Sales only, not listings: listings run around 176 a day off a single relister,
which would post every eight minutes forever.

### The `#gallery` post

Every six hours, one random item from the collection into `#gallery`. This is the
old `RANDOM_INTERVALS` feature, at the cadence it ran at before it stopped in May
2026.

## Deployment

GitHub Actions deploys `worker/` to Cloudflare on every push to `main` that
touches it, via [`.github/workflows/deploy-worker.yml`](.github/workflows/deploy-worker.yml).
The workflow typechecks, runs the tests, validates the bindings with a dry-run
deploy, deploys, then pokes the gateway health tick, because replacing the isolate
drops the WebSocket and inline lookups would otherwise stay dark until the next
cron.

There is no droplet, no PM2, no container. Deploying by hand is
`npx wrangler deploy` from `worker/`.

### Secrets

Secrets live in Cloudflare and nowhere else. They are set once, by hand, and a
deploy leaves them alone:

```
wrangler secret put DISCORD_TOKEN
wrangler secret put DISCORD_APP_ID
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put OPENSEA_API_TOKEN   # optional, public tier works
                                        # OPENSEA_API_KEY works too, same key
wrangler secret put ADMIN_TOKEN         # gates /_admin/gateway/*
```

Nothing in this repo reads or writes them, and none of them belong in a file
here. `CLOUDFLARE_API_TOKEN` and `WORKER_ADMIN_TOKEN` are GitHub Actions secrets,
used only by the workflow.

Channel and guild ids are not secrets and are inline constants in
`worker/src/config.ts`.

## Health and operator routes

- `GET /health` reports liveness and the gateway DO's status.
- `POST /_admin/gateway/{connect,reconnect,health-tick,status}` opens or repairs
  the socket. All four require `Authorization: Bearer $ADMIN_TOKEN`. With
  `ADMIN_TOKEN` unset they answer 503 rather than running unauthenticated.

## Coming soon

None of this is built. The old Node implementations were deleted rather than
carried forward, so reviving any of them means writing them against the Worker,
not switching something back on. The conversion path is in
[`plans/cloudflare-consolidation.md`](plans/cloudflare-consolidation.md) under
"Conversion path for everything shelved", and the old code is in the git history
at `d668f57` if it is worth reading first.

- **Arena battles.** Never finished, even on the old bot. Combat resolution was
  never written, so a round could be started but never resolved. Reviving it
  means writing that resolution and picking a store for per-battle state. There
  is no working version of this to go back to.
- **Playground rotation.** Spotlights, postcards, discoveries, encounters and
  recaps. It posted into a channel that has since been deleted, and it needs a
  scheduling model to run on crons.
- **Lore.** AI-generated stories from artifacts. Also posted into a deleted
  channel, and it needs Google AI and OpenRouter keys.
- **`/wallet` and `/mybots`.** Not broken, but they wrote wallet bindings to a
  local state file that went away with the droplet. A KV namespace
  (`GLYPHBOTS_KV`) is reserved for `wallet:<userId>` keys and is read by nothing
  until these come back.

The four mechanical changes any of these need are the same ones the Worker port
already made: raw REST instead of the `Client`/`Channel` object model, cron
triggers or DO alarms instead of `setInterval`, DO storage or KV instead of local
state files, and request-scoped `env` instead of module-scope `process.env`.

## Where to read next

- [`worker/README.md`](worker/README.md) for the Worker's layout, bindings,
  cursor design and local development.
- [`plans/cloudflare-consolidation.md`](plans/cloudflare-consolidation.md) for
  why the migration looks the way it does.
- [`plans/EXECUTION.md`](plans/EXECUTION.md) for what is done and what is next.

---

Built for the [GlyphBots](https://glyphbots.com) community.
