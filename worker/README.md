# glyphbots-worker

The Cloudflare Worker the three GlyphBots Discord bots consolidated onto. It
covers all of [`plans/cloudflare-consolidation.md`](../plans/cloudflare-consolidation.md)
plus the idle work, which is not in that plan.

**What it does today:**

- A cron fires every five minutes, asks the GlyphBots API for recently minted
  artifacts, and posts anything new into `#general` as an embed.
- `POST /discord/interactions` verifies Ed25519 and serves eight slash
  commands: `/bot`, `/artifact`, `/floor`, `/sales`, `/listings`, `/owner`,
  `/rarity`, `/activity`.
- A Durable Object holds one WebSocket to the Discord gateway and answers
  inline `b#123` / `a#123` / `#username` lookups, in `#general` and
  `#show-and-tell` only.
- A second cron posts one random collection item into `#gallery`, but only when
  `#general` has been quiet for a day, and at most once a day.

- A third cron posts OpenSea sales into `#trading-floor`, from both collections,
  grouped when several land together. Sales only: listings run around 176 a day
  off one relister, which would post every eight minutes.

- A fourth cron checks hourly whether `#general` has gone 48 hours without a
  human message and, only then, posts one item into it: a random bot, a random
  artifact, a collection fact or a notable bot, in rotation, no more than once a
  day.

This is the whole system. Three Discord bots used to do this across three
processes on a droplet, supervised by a fourth. Their repos are retired, and the
Node bot that lived in this repo was deleted once the Worker took over. Git
history has it at `d668f57`.

## Layout

```
src/
  index.ts                        Hono app, scheduled() handler, DO export
  config.ts                       ids, contracts, colors, every tuning number
  types.ts                        WorkerEnv bindings
  api/glyphbots.ts                GlyphBots client, built per invocation
  api/opensea.ts                  OpenSea client, built per invocation
  api/rarity-ranks.ts             ranks for a list of bots, one request
  api/types.ts                    Artifact, Bot and OpenSea shapes
  api/collections.ts              the two collections, and which one an event is
  api/artifact-details.ts         one artifact's title, art and source bot
  channels/gallery.ts             the #gallery post, gated on quiet
  channels/idle.ts                the idle clock and both post decisions (pure)
  channels/nudge.ts               one idle check on #general
  channels/nudge-content.ts       the four things a nudge can say
  channels/mints.ts               cursor logic + one poll
  channels/sales.ts               the sales cursor, the queue, one tick
  channels/sales-grouping.ts      the settle-window batcher (pure)
  channels/sales-embeds.ts        one sale and one sweep, as embeds
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
  durable-objects/feed-state.ts   FeedStateDO, all three feed records
  durable-objects/gateway.ts      GatewayDO, the WebSocket to Discord
  durable-objects/gateway-client.ts      connect / status / reconnect / tick
  durable-objects/feed-stores.ts  read + apply, one factory, three records
  lookups/matcher.ts              b#123 / a#123 / #username parsing (pure)
  lookups/embeds.ts               one embed per match
  lookups/rate-limit.ts           per-channel window + cooldown
  lookups/handle.ts               the gates, in order, then the reply
  routes/admin.ts                 /_admin/gateway/*, ADMIN_TOKEN gated
  routes/interactions.ts          POST /discord/interactions
  utils/logger.ts                 console logger
scripts/register-commands.ts      operator-run guild registration (see below)
test/mints.test.ts                cursor, burst guard, retry on a failed send
test/sales.test.ts                seeding, exactly-once, hold-back, deferral
test/sales-artifacts.test.ts      both slugs swept, artifacts rendered as such
test/sales-grouping.test.ts       the flush predicate and the processed set
test/opensea.test.ts              the events sweep: pagination and truncation
test/rarity-ranks.test.ts         the rank resolver: batching and caching
test/interactions.test.ts         signature, PING/PONG, defer inversion, wiring
test/commands.test.ts             per-command response shaping
test/lookups.test.ts              matcher, allowlist, rate limiter, one message
test/gateway.test.ts              frames, close codes, heartbeats, routing
test/gallery.test.ts              the #gallery tick and its idle gate
test/nudge.test.ts                the idle clock, the rotation, the facts
test/cron.test.ts                 which cron runs which job
test/*-fixtures.ts                shared stubs; see the note at the top of each
```

## Environment

Bindings arrive on `env` and are threaded down as arguments. Nothing under
`src/` reads `process.env`, and no module captures configuration at import
time. The Node bot did exactly that (`src/api/glyphbots.ts:17` at `c75d6a8`),
which is why the client needed porting rather than copying: on Workers the
module body runs before any binding exists, so the capture would always be the
fallback. `scripts/register-commands.ts` is the one file that reads
`process.env`, and it is not part of the bundle.

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
  decision 7 of the plan. Provisioned, bound, and read by nothing. In a fresh
  account, create it and paste the id into `wrangler.jsonc` before the first
  deploy:

  ```
  wrangler kv namespace create GLYPHBOTS_KV
  ```

There is no `nodejs_compat` compatibility flag, and nothing in the bundle needs
one. Leaving it off keeps a stray `node:` import a build failure rather than
something that quietly starts working.

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

### Every record takes an operation

This applies to all three records in `FeedStateDO`, and it is the part worth
reading before changing any of them.

The input gate serializes each `fetch` into the DO, not a *pair* of them. A tick
that read a record, spent several seconds fetching an API and posting to
Discord, and then wrote a whole new value would have its read and its write on
opposite sides of the gate: a tick that overlapped it would have its record
silently replaced. That is the failure the Durable Object was chosen to avoid,
reintroduced one layer up.

So the store interface is `read` and `apply`, never `read` and `write`. The
caller sends *what changed* and the DO reads, applies and writes with nothing
awaited in between:

```
mint cursor   { op: "seed" | "advance", handled: [...], failed: [...] }
sales state   { op: "seed" | "commit",  processedKeys, actorGroups, deferred, advanceTo }
idle clock    { op: "seed" | "human-message" | "nudge" | "gallery", atMs, kind }
```

Three merge rules are worth naming because they only exist on this side of the
gate. A `seed` never overwrites a record that already exists, so two ticks that
both read `null` cannot have the second reset the first. The sales key set is
**unioned** rather than replaced, because a tick that overlapped this one has
already posted the sales behind its keys and dropping them would repost. And the
cursors only move forward: `advanceTo` was computed against the record as the
tick read it, which may be behind the record as it now stands.

There is a second, smaller benefit. Validation now happens on a small operation
rather than on a whole computed record, so there is no path where a post
succeeds and the write recording it is rejected as malformed, leaving the next
tick to post it again.

What is *not* merged: the sales feed's pending settle-window groups and its
deferred queue are the committing tick's view outright. Merging two
half-finished settle windows is not a well-defined operation, and unlike the key
set, getting it wrong delays a message rather than duplicating one.

**The first tick after deploy posts nothing.** With no cursor in storage the
watcher seeds from the current newest mint and logs how many historical mints it
skipped. That is the cold-start path working, not a failure. The first real
post arrives with the next actual mint.

Above five new mints in one poll the burst guard posts the newest five
individually plus one summary line for the remainder, and advances the cursor
past all of them so the burst is never replayed.

## The sales feed

`#trading-floor`, on its own five minute cron offset two minutes from the mint
watcher. One record in `FeedStateDO` under `salesState` holds the cursor, the
pending groups, the processed key set and the send queue, so all four move in
one write and cannot disagree with each other.

`lastEventTimestamp` comes from the events' own `event_timestamp` and never
from the wall clock. The fetch window reaches 120 seconds behind it on purpose,
because OpenSea indexes events slightly after they happen and a query starting
exactly at the cursor misses anything that landed late with an older timestamp.
That overlap re-serves recent events on every tick; `grouping.processedKeys` is
what makes it harmless, doing the job `postedArtifactIds` does for mints.

**Both collections.** The bots and the artifacts are two OpenSea collections
with two slugs and two contracts, and the events endpoint is scoped by
collection, so a tick sweeps `glyphbots` and `glyphbots-artifacts` and merges
the two into one timeline. One cursor covers both: a failed or truncated sweep
of either holds or limits it for both, since there is no way to say "caught up
on bots, behind on artifacts" in a single number, and re-reading a window the
processed keys already reject costs nothing.

`api/collections.ts` holds the descriptors and is the only thing that decides
which collection an event came from. Downstream that decides four things: what
an unnamed item is called, where its picture comes from, which marketplace link
is right, and whether there is a rarity rank at all. Artifacts are ERC-1155 and
unranked, so they carry a quantity when a sale is more than one copy, and they
link the bot they were generated from instead of a rank. A third collection is a
third entry in that file.

Groups are keyed by buyer *and* collection, so one buyer taking two bots and two
artifacts inside a settle window gets two messages. That is what lets a group
title name what was bought ("2 artifacts purchased"), link the right collection
and draw its thumbnail from the right place.

**Sales only.** Listings run about 176 a day against the bots, almost all of it
one operator's relister, which would put a message in the channel every eight
minutes forever. Sales run 1.24 a day. Turning listings back on is more than
adding a string to `SALES_EVENT_TYPES`: the embeds hard-code purchase copy and
read `buyer`, which a listing has no value for. The comment on that constant
says what it would actually take.

**A sweep is one message.** A buyer taking ten items produces one grouped embed
rather than ten posts. The batcher has no timers anywhere in it: a group flushes
once it holds at least two events and 60 seconds have passed since the last one
was added, which is a pure function of stored state and `now`. That is the only
reason grouping survived the move from a process to a cron, and it is why the
grouping pass runs even on a tick that fetched nothing.

**Nothing sleeps.** The Node bot paced messages with a 3 second wait between
sends. A cron invocation must not sleep, so the pacing is a cap of five messages
per tick with the remainder carried in `deferred` and sent first next time.
Nothing is dropped, it arrives five minutes later. An undelivered message holds
the cursor back to at or below its oldest event, exactly like a failed mint
send, and its key is what stops the rewind causing a repost.

**Every bot price has a rank next to it.** A bot sale embed carries the rarity
rank beside the price, and a sweep carries one per item in its top-items list,
because 0.42 ETH says nothing on its own about whether that was a good buy.
`/sales` and `/activity` print the same badges. See "Where the rank comes from"
below. Artifacts are not ranked and are never looked up in that table, which
matters because it answers by token id alone: asking it about artifact #180
would come back with bot #180's rank.

A truncated sweep is the case worth knowing about. OpenSea serves newest first,
so a sweep that runs out of its ten page budget is missing the *oldest* events
in the window, and advancing to the newest one it saw would step over every one
of them without a word. It advances only as far as it actually read. If the next
tick truncates in the same place and so makes no progress, it gives the
unreachable tail up rather than pinning the cursor forever, and logs that at
error level naming the timestamp it abandoned.

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

### Where the rank comes from

Two ranks exist for every bot and they are not the same number. OpenSea
computes one with OpenRarity and hands it back on `nft.rarity.rank`; the
GlyphBots API stores its own on the bot record, and that is the one
glyphbots.com shows.

`/rarity`, `/bot` and the inline `b#123` lookup read OpenSea's, because those
are one token per reply and the NFT read is already being made. `/sales`,
`/activity` and the sales feed read the GlyphBots one through
`POST /api/bots`, which takes the whole list: eight sale lines cost one
subrequest instead of eight, against no rate limit this Worker has to plan
around. `src/api/rarity-ranks.ts` is that resolver, one per invocation or per
tick, caching misses as well as hits.

The gap between the two sources is small but visible. Sampled live on
2026-08-02, they sat within one to three percent of supply of each other (token
42: 791 against 845; token 2500: 4,917 against 5,131) and landed in the same
tier every time. So a rank on a sale line can read a couple of hundred places
off the same bot's `/rarity` reply. That is known, and the alternative was
eight OpenSea calls per list.

A bot with no rank prints no badge. There is no placeholder, and a rank of zero
is treated as no rank everywhere it is read, because `percentileOf(0)` clears
every threshold in the tier table and would label an unranked bot Legendary.

### Wallet linking is not built

The Node bot called `getUserWallet` (`src/commands/bot.ts:181` at `c75d6a8`) to bias
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

- `alarm()` treats a null `liveWs` as "reopen", whatever the stored state says,
  unless that state is `failed`. `failed` is checked first and parks: the six
  close codes that reach it are conditions only a human can clear, so an alarm
  that fired against one would be an infinite reconnect loop.
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

## The idle nudge

The guild is about thirty people and can go days without a message. The nudge
exists so the bot has something to say when that happens, and says nothing at
all when it does not.

**It posts because it is quiet, not on a schedule.** The cron is hourly, but
hourly is the rate it *checks*, not the rate it posts. An ordinary day is
twenty-four ticks and zero posts, and `wrangler tail` shows
`Idle nudge: not-quiet` twenty-four times. That is the feature working.

```
#general silent for 48 hours  ->  post one item
still silent                  ->  at most one more per 24 hours
anybody says anything         ->  silent again until 48 hours have accumulated
```

The threshold is measured from the last human message and the cooldown from the
last nudge, and both are needed. Threshold alone would repost every hour for as
long as the silence lasted; cooldown alone would post daily into a busy channel.

### Where the clock lives, and why it is not in the gateway DO

`FeedStateDO`, under `idleState`, next to the mint cursor and the sales state.

The obvious place is a field on `GatewayDO`, which is the thing already
receiving `MESSAGE_CREATE`. That is wrong in both directions and both failures
are silent. A fresh DO after a deploy has no timestamp: read as "nothing since
the epoch" the first tick sees infinite silence and fires, and read as "now" a
nudge that was genuinely due is suppressed for another two days. The DO is also
evicted on relocation, not only on deploy, so no deploy schedule can reason
about it.

Two writers touch the record, the gateway on every human message and the cron
once an hour, so the read-modify-write happens **inside** the DO: the store
(`durable-objects/feed-stores.ts`) sends an operation rather than a whole value,
and `applyIdleUpdate` runs behind the input gate. A whole-record write from the
cron would otherwise discard a message that arrived while it was building an
embed, which is the one failure that would have the bot talking over somebody.

All three records work this way now, for a version of the same reason. See
"Every record takes an operation" below.

Two more properties of that merge: a `seed` never overwrites a clock that
already exists, and a `human-message` takes the maximum rather than the
argument, so an out-of-order event cannot wind the clock backwards and
manufacture silence.

**The first check after a deploy posts nothing.** With no record in storage the
clock is seeded to the current time and the tick returns. Same cold start as the
mint watcher, for the same reason.

### What resets the clock

Only a non-bot message in `#general`. Our own nudge lands in that channel as a
`MESSAGE_CREATE` like anything else, and a clock that accepted it would restart
its own 48 hours on every post: one nudge, ever. The mint watcher posts into
`#general` under the same account and is ignored for the same reason, so a mint
does not count as the room being awake. Both the `bot` flag and an id match
against ourselves are checked.

### What it posts

Four kinds in rotation, so the same kind never lands twice running:

| Kind | Shape | Cost |
|---|---|---|
| `bot` | the `/bot` embed, exported from `commands/bot.ts` | 3 subrequests |
| `artifact` | the `/artifact` embed, exported from `commands/artifact.ts` | 2 |
| `stat` | one collection fact, several phrasings | 2 |
| `notable` | best rank out of three random draws | up to 3 |

The first two are the command builders themselves rather than copies, so a
nudge and a slash command render identically. The last two are built in
`channels/nudge-content.ts` out of the same formatters and the same rarity
table `/rarity` uses.

`notable` samples rather than searches because there is no reverse index from
rank to token id anywhere in this system: the rank arrives attached to a token,
so finding a rare one means looking at tokens. Three draws, keeping the best,
stopping early on anything inside the top 10%. The post states the rank it found
and does not claim the bot is the rarest of anything.

If the chosen kind has nothing to say (a burned token, an empty artifact list, a
dead upstream) it falls through to the next kind once, then gives up and waits
an hour. A failed send records no cooldown, so a message nobody saw does not buy
the guild another day of silence.

### The facts are checked, not generated

Every number is read straight off a response and printed with the same
formatters `/floor` uses. Nothing is derived, averaged, compared to a previous
value or rounded into a claim the source did not make. Facts whose input is
missing or zero are not offered at all, and a floor price is only quoted when
OpenSea says it is denominated in ETH, because `formatEthStat` writes the unit
in and a floor quoted in the wrong currency is a false statement rather than a
formatting slip. `collectionFacts` returns the list of things that are currently
true and one is chosen from it.

## The #gallery cron

`0 */6 * * *`, and since the idle work it fires four times a day but posts at
most once: only when `#general` has been quiet for 24 hours, and no more often
than every 24 hours.

It used to post unconditionally, which in a guild this size meant the bot
posting to itself four times a day. That is the shape of a dead channel, not a
lively one. The rule now:

- **an active server barely sees it.** Somebody having spoken yesterday
  suppresses it entirely. `#gallery` is a filler channel and filler is welcome
  only when there is nothing else.
- **a dead server sees one a day, not four.** Three of the four ticks fall
  inside the cooldown and cost one Durable Object read each.
- **it leads the nudge rather than duplicating it.** `#gallery` starts at 24
  hours of quiet and the `#general` nudge at 48, so a quietening server gets the
  low-stakes post first, in the channel meant for it. Once both are firing they
  are one post a day each, in different channels.

Half the nudge's threshold, the same cadence: a quieter server never makes the
bot faster, only slightly earlier.

`#general` is the signal for both because it is the only activity signal the
Worker has, and it is where the guild actually talks.

Whose turn it is is stored now rather than derived from the clock. The old
version alternated on six-hour buckets since the epoch, which is correct only
while the cron posts on every tick: gated to one post a day, consecutive posts
sit four buckets apart, the same parity every time, and the channel would have
shown bots and nothing else forever.

The recently-posted memory the Node bot kept stays dropped: at one post a day
across 11,111 bots a repeat is not worth a round trip.

`scheduled()` dispatches on `event.cron`, so no cron runs another's work. The
five minute entry runs the mint watcher and pokes the gateway watchdog, the
offset five minute entry runs the sales feed, the six hour entry runs the
gallery, and `23 * * * *` runs the idle check. Minute 23 misses both five minute
entries, which land on minutes ending 0 or 5 and 2 or 7. Note that
`wrangler deploy --dry-run` does **not** validate cron expressions, so those
strings are correct by inspection or not at all.

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
7. **The idle work needs a quiet server to observe.** `#gallery` and the nudge
   both post nothing for the first 24 to 48 hours after a deploy whatever the
   guild does, because the clock is seeded on the first check. After that,
   `wrangler tail` around `:23` should show `Idle nudge: not-quiet` on an active
   day; the first real nudge only arrives after two days of actual silence.

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
  images the plan's preflight flagged.
- **Guild permissions.** The bot needs View Channel, Read Message History and
  Send Messages in `#general`, `#show-and-tell` and `#gallery`. Nothing here
  checks that, and a missing permission looks exactly like a broken bot.
- **The 50-subrequest budget under a real burst.** The arithmetic above says it
  fits; only a live burst proves it.
- **A nudge or a gallery post actually firing.** Both are covered end to end
  against an injected clock, but the shortest real observation is two days of
  guild silence, so nothing here has watched one land.
- **Cron expression validity.** `wrangler deploy --dry-run` does not check them
  (tested), and the dashboard is the only place that will say whether
  `23 * * * *` was accepted.
- **`GET /api/artifacts/recently-minted?summary=true` staying that shape.** It
  was read live on 2026-07-26 and returns a bare
  `{total, last1d, last7d, last30d}` with no `ok` envelope. The client rejects a
  response missing any of the four rather than printing a zero.

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
npm run lint          # biome check: formatting, recommended lints, import order
npm run lint:fix      # the same, applying what it can
npm run typecheck
npm test
npm run dry-run       # wrangler deploy --dry-run, no auth, no deploy
npm run dev           # local wrangler dev
```

Lint, typecheck and test all run in CI before a deploy.

Biome's config is `biome.jsonc`, and the extension matters: comments in a file
named `biome.json` make Biome discard the whole config silently, which reads as
a linter that finds nothing. Recommended rules only, and the formatter block is
written out rather than left to the defaults because bare Biome formats with
tabs and this package is 2-space. `wrangler.jsonc` is deliberately outside
Biome's `files.includes`, so the production config is never reformatted.

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
