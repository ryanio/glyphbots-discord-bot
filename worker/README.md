# glyphbots-worker

The Cloudflare Worker that the three GlyphBots Discord bots are consolidating
onto. Phases 1 to 3 of [`plans/cloudflare-consolidation.md`](../plans/cloudflare-consolidation.md).

**What it does today:**

- A cron fires every five minutes, asks the GlyphBots API for recently minted
  artifacts, and posts anything new into `#general` as an embed.
- `POST /discord/interactions` verifies Ed25519 and serves eight slash
  commands: `/bot`, `/artifact`, `/floor`, `/sales`, `/listings`, `/owner`,
  `/rarity`, `/activity`.
- A Durable Object holds one WebSocket to the Discord gateway and answers
  inline `b#123` / `a#123` / `#username` lookups, in `#general` and
  `#show-and-tell` only.
- A second cron posts one random collection item into `#gallery` every six
  hours.

No OpenSea sales feed yet. That is Phase 4.

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
  channels/gallery.ts             the six-hourly #gallery post
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
  durable-objects/gateway.ts      GatewayDO, the WebSocket to Discord
  durable-objects/gateway-client.ts      connect / status / reconnect / tick
  durable-objects/mint-cursor-store.ts   the narrow read/write interface
  lookups/matcher.ts              b#123 / a#123 / #username parsing (pure)
  lookups/embeds.ts               one embed per match
  lookups/rate-limit.ts           per-channel window + cooldown
  lookups/handle.ts               the gates, in order, then the reply
  routes/admin.ts                 /_admin/gateway/*, ADMIN_TOKEN gated
  routes/interactions.ts          POST /discord/interactions
  utils/logger.ts                 console logger
scripts/register-commands.ts      operator-run guild registration (see below)
test/mints.test.ts                mint watcher coverage, ported from ../test
test/interactions.test.ts         signature, PING/PONG, defer inversion, wiring
test/commands.test.ts             per-command response shaping
test/lookups.test.ts              matcher, allowlist, rate limiter, one message
test/gateway.test.ts              frames, close codes, heartbeats, routing
test/gallery.test.ts              the #gallery tick
test/cron.test.ts                 which cron runs which job
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
wrangler secret put ADMIN_TOKEN          # /_admin/gateway/*, see below
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

`ADMIN_TOKEN` is a shared secret for the four operator routes under
`/_admin/gateway/`. Those routes can open and force-reconnect the live gateway
socket, so they are not public. **Unset means 503, never "no auth required."**

## Bindings

- `FEED_STATE`, the `FeedStateDO` namespace. Durable Objects need Workers Paid.
- `GATEWAY`, the `GatewayDO` namespace. One instance, `idFromName("singleton")`.
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

## The gateway

One Durable Object holds one WebSocket to `wss://gateway.discord.gg`, modelled
directly on Coral's `packages/worker/src/durable-objects/discord-gateway.ts`.
That DO has been running this lifecycle in production for months, so the
differences here are all subtractions.

### It does not hibernate, and that is not a cost oversight

Cloudflare's hibernating WebSocket API takes an **incoming** `WebSocketPair`.
A socket that came back from an outbound `fetch()` cannot be handed to
`state.acceptWebSocket()`; it throws "pair has already been accepted or used in
a Response". A gateway connection is outbound by definition, so hibernation is
not an option for it at all, whatever it would cost. Coral records the same
finding in a comment at `discord-gateway.ts:468-477`.

The saving would have been small anyway. Discord's `heartbeat_interval` is
about 41 seconds, so the DO is woken by its own alarm roughly 2,100 times a day
regardless of what happens on the socket.

The failure this avoids is worth naming, because it is the worst one available
here: a socket that is `accept()`ed while the DO is allowed to be evicted loses
its in-memory reference while Discord still believes the connection is up. The
bot looks healthy and answers nothing, for hours. Two guards exist for it
anyway, because "should not happen" is not a monitoring strategy:

- `alarm()` treats a null `liveWs` as "reopen", whatever the stored state says.
- the `/health-tick` watchdog rides the five minute mint cron and reopens
  anything that is not live, or that is live but has heard nothing in 90
  seconds with a heartbeat unacked.

### Intents

`GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT` = `33281`. Oracle also has Presence
and Server Members granted (application flags `565248`), and both are
deliberately **not** requested: nothing in scope reads them, and an unused
intent is a larger `READY` payload plus a stream of events to discard.

If `MESSAGE_CONTENT` is ever turned off in the portal, the gateway closes
`4014`, which is fatal here: the DO parks in `failed`, logs loudly, and does
not reconnect. A reconnect loop against a permission a human has to restore is
just a way to get rate limited.

### Reconnect behavior, by close code

| Code | Disposition | What happens |
|---|---|---|
| 4004, 4010, 4011, 4012, 4013, 4014 | fatal | `wsState: failed`, alarm cleared, no reconnect. The watchdog leaves it alone. Only `/_admin/gateway/connect` restarts it. |
| 4007, 4009 | re-identify | Session, resume URL and sequence are dropped, then reconnect on the backoff. A RESUME into a dead session only earns an INVALID_SESSION and another round trip. |
| everything else (1000, 1001, 1006, 4000-4003, 4005, 4008, …) | resume | Session and sequence are kept, reconnect on the backoff, RESUME on the next HELLO. |

Backoff is `1s, 2s, 5s, 15s, 60s`, one step per consecutive close, held at 60s,
reset to the start on READY or RESUMED.

Note the treatment of 1000 and 1001. Discord uses them to end a session for
good, but they are also what this DO sends itself on an admin reconnect, a
missed heartbeat ack, and an `op=7`. The two are indistinguishable at that
layer, so the optimistic branch is taken. If the session really is gone the
gateway answers `op=9 INVALID_SESSION`, which drops the session and
re-IDENTIFYs after the protocol's 1 to 5 second wait. The pessimistic case
costs one extra round trip and self-corrects; the common case keeps its
session, which is what makes `/reconnect` resume rather than replay.

`op=9` also counts consecutive resume failures, and logs at error level once
three land in a row. Three means the session is not sticking and something
structural is wrong.

### Admin routes

All four require `Authorization: Bearer $ADMIN_TOKEN`.

```
POST /_admin/gateway/connect       open the socket if it is not open
GET  /_admin/gateway/status        wsState, seq, heartbeat, failure reason
POST /_admin/gateway/reconnect     close and reopen, resuming the session
POST /_admin/gateway/health-tick   what the cron calls; open or repair
```

`GET /health` carries the same status block, unauthenticated, minus anything
sensitive. The session id is never returned by either, only a `hasSession`
boolean.

## Inline lookups

`b#123` is a bot, `a#123` is an artifact, `#123` is a bot, `#random` (also
`#rand`, `#?`) is a random bot, and `#someone` resolves an OpenSea username to
one bot that account holds.

**Only `#general` and `#show-and-tell`.** The Node bot this came from
(`discord-nft-embed-bot`) replied in every channel it could see and in DMs. On
a droplet that was free. On Workers each embed is several sequential API calls
against a per-invocation subrequest budget, so the surface has to be bounded
before anything else is. DMs have no channel id in the allowlist, so they drop
with everything else.

Gates run cheapest-first and nothing touches the network until all of them
pass: bot author (including itself), then guild, then channel, then whether the
text parses as a lookup at all, then the rate limit. The parse sits before the
rate limit on purpose, so ordinary conversation in a busy `#general` never
spends the channel's lookup budget.

### Cost per lookup

The Node bot fired five calls per embed: the NFT, the collection slug, the last
sale, the best offer and the best listing (`src/index.ts:174-200`). Six embeds
was thirty-plus subrequests before the reply. The plan calls for cutting that
trio, and this does:

```
b#123      2 subrequests   GlyphBots bot record + one OpenSea read (owner, rank)
a#123      2 subrequests   artifact + origin bot name
#username  4 subrequests   account, account NFTs, then the bot lookup's two
```

Six of the most expensive kind is 24. Price history is still one `/bot`,
`/sales` or `/listings` away, and those are separate invocations with their own
budget.

### Rate limiting

Per channel, in the DO's memory, Coral's shape plus a cooldown:

- ten answered lookups per channel per rolling 60 seconds,
- at least 3 seconds between two answers in the same channel,
- at most six embeds on one reply (Discord's own limit, and the Node bot's
  `MAX_EMBEDS_PER_MESSAGE`),
- repeated matches in one message collapse, so `b#1 b#1 b#1` costs one lookup.

The state resets when the DO is evicted. That is deliberate and matches Coral:
this is a spend guard, not a security control, and persisting it would put a
storage write on the hot path of every message in the guild.

## The #gallery cron

`0 */6 * * *` posts one random collection item into `#gallery`, alternating
bots and artifacts. This is `RANDOM_INTERVALS` from
`discord-nft-embed-bot/src/index.ts:696-746` with the `setInterval` removed,
running at the six hour cadence it had before it stopped on 2026-05-02.

`scheduled()` dispatches on `event.cron`, so the two crons never run each
other's work. The five minute entry runs the mint watcher and pokes the gateway
watchdog; the six hour entry runs the gallery and nothing else.

Whose turn it is comes from the clock (six hour buckets since the epoch,
alternating) rather than from storage, so two isolates cannot disagree. The
recently-posted memory the Node bot kept is dropped: at six hours across 11,111
bots a repeat is rare enough not to be worth a Durable Object round trip. If it
ever becomes visible, the fix is a `galleryRecent` key in `FeedStateDO`.

## Smoke testing a deploy

Tests cannot reach a real gateway, so this list is the actual verification.

1. `curl $WORKER/health` and read the `gateway` block. Within five minutes of a
   deploy it should show `wsState: "live"`, a non-null `selfUserId`, a
   `lastSeq` that is not null, and `heartbeatAckPending: false`.
2. Post `b#1` in `#general`. An embed with the PNG image should come back as a
   reply within a couple of seconds.
3. Post `b#1` in `#trading-floor`. Nothing should happen. This is the allowlist,
   and it is the check most worth doing by hand.
4. Post ten lookups quickly in `#general`. The first answers, the next few are
   dropped by the cooldown, and the channel stops answering entirely once ten
   land inside a minute. `wrangler tail` shows `Rate-limited (cooldown)` and
   `Rate-limited (window)`.
5. `POST /_admin/gateway/reconnect`, then `GET /_admin/gateway/status`. It
   should return to `live` within a few seconds with `hasSession: true`, and
   the channel should not replay old messages. A RESUMED line appears in
   `wrangler tail`; a READY line instead means the session did not survive,
   which is worth investigating but not broken.
6. **Come back the next day.** `wsState` should still be `live` and `lastEventAt`
   should be recent. The failure this whole design is defending against does
   not show up in the first ten minutes.
7. Watch for one `#gallery` post at the next six-hour boundary.

## What is not verified, and cannot be from here

- **Any real gateway connection.** `openGateway` is the one path with no test
  coverage: `/gateway/bot` discovery, the 101 upgrade over Workers' `fetch`,
  and whether Discord accepts the IDENTIFY. Everything below it (frames, close
  codes, heartbeats, routing) is covered with a stub socket.
- **Whether the connection survives for days.** The heartbeat-ack check, the
  backoff, and the watchdog are all tested in isolation. Their behavior across
  a real Discord outage or a DO relocation is not.
- **RESUME actually resuming.** The RESUME frame is asserted; that Discord
  accepts it and replays the gap is not.
- **Discord rendering of the embeds**, including the multi-megabyte artifact
  images the plan flagged in Phase 1.
- **Guild permissions.** The bot needs View Channel, Read Message History and
  Send Messages in `#general`, `#show-and-tell` and `#gallery`. Nothing here
  checks that, and a missing permission looks exactly like a broken bot.
- **The 50-subrequest budget under a real burst.** The arithmetic above says it
  fits; only a live burst proves it.

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
