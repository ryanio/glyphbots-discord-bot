# Cloudflare consolidation: three Discord bots onto one Worker

> **Status 2026-07-25.** The GlyphBots guild is dark. The DigitalOcean droplet
> that ran all three bots is cancelled, so Oracle (this repo), Embed
> (`discord-nft-embed-bot`) and Activity (`opensea-activity-bot`) are all
> offline with no host. Their state files went with the droplet. The decision is
> made: port directly onto one Cloudflare Worker following the Coral pattern
> (`/Users/rg/dev/coral/packages/worker`), accept the downtime, do not bridge on
> a container first. This document is the execution plan.
>
> Phase 1 is deliberately the shortest path to a live server posting mints,
> because "dark guild" is the actual problem and everything else is a feature.

## The three sources

| App | Repo | src LOC | What survives the port |
|---|---|---|---|
| Oracle | `glyphbots-discord-bot` | 13,869 | mint watcher, 8 of 17 slash commands |
| Embed | `discord-nft-embed-bot` | 2,401 | inline `b#123` / `a#123` / `#username` lookups |
| Activity | `opensea-activity-bot` | 4,940 | sales + listings feed to Discord |

Roughly 21k lines of Node collapse into one Worker that keeps maybe a third of
it. The rest is either dead, unfinished, or deliberately shelved (see
"What is being dropped").

## Target architecture

One Worker, one Discord application, one bot token.

```
glyphbots-worker (Hono)
├── POST /discord/interactions      Ed25519 verify -> route -> defer + waitUntil
├── GET  /health                    liveness + gateway DO status
├── POST /_admin/gateway/{connect,reconnect}    operator control
│
├── DO  GatewayDO   (singleton)     hibernating WS to Discord gateway
│                                   MESSAGE_CREATE -> inline lookup replies
│                                   storage: session, lastSeq, resumeUrl
├── DO  FeedStateDO (singleton)     mint cursor + OpenSea cursor + pending
│                                   settle-window groups (see "Batcher")
│
├── cron */5 * * * *                mint watcher   -> #general
├── cron * * * * *                  opensea feed   -> #trading-floor
│
└── KV  GLYPHBOTS_CACHE             OpenSea response cache, username cache,
                                    per-channel inline-lookup rate limits
```

Ids are inline constants in one module, not env vars, matching Coral's hard rule
(`/Users/rg/dev/coral/AGENTS.md`, "Discord/Telegram ids are inline constants").
The only secrets are `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`,
`OPENSEA_API_TOKEN`.

```
GUILD_ID          1445933082938183743
GENERAL           1445933084401864767   mints
TRADING_FLOOR     1446247601942036574   sales + listings
SHOW_AND_TELL     1446248716536123502   topic already advertises b#/a#
```

No new channels. The `LORE_CHANNEL_ID`, `ARENA_CHANNEL_ID` and
`PLAYGROUND_CHANNEL_ID` values in `.env` all 404 against the live API and are
deleted, along with the code that reads them (`src/lib/utils.ts:46,49,52`).

### Deviation from Coral: crons, not Inngest

Coral has no `triggers.crons` block in `packages/worker/wrangler.jsonc`; its
schedules run through Inngest's serve handler mounted at `/inngest`
(`/Users/rg/dev/coral/packages/worker/AGENTS.md`, "Inngest wiring"). That buys
retries, observability and a function registry, at the cost of an Inngest
account and signing keys. GlyphBots has two crons whose failure mode is "wait
five minutes and it retries itself." Use native Cloudflare cron triggers and a
`scheduled()` handler. Everything else follows Coral.

### Deviation from Coral: no container

Coral's `Sandbox` container exists for AI, chart rendering and heavy provider
work. Nothing in scope here needs it. Every in-scope path is fetch, transform,
POST to Discord. The Worker bundle is the whole runtime.

## What is being dropped, with evidence

### The arena (shelved, not removed)

The arena is 3,109 lines across `src/arena/` plus `src/commands/arena.ts` (560)
and `src/channels/arena.ts` (176). It does not work. Combat resolution was never
implemented: `src/arena/interactions.ts:552` reads

```
  // Combat resolution will be handled separately when both fighters select
```

and there is no other implementation. A player selects an ability, gets "Waiting
for opponent...", and nothing ever resolves the round. Downstream of that
missing piece, three modules are unreferenced by anything outside the arena
directory itself:

| File | LOC | Referenced from |
|---|---|---|
| `src/arena/images.ts` | 244 | nothing, anywhere in `src/` |
| `src/arena/narrative.ts` | 241 | nothing outside itself |
| `src/arena/combat.ts` | 484 | only `getFighterAbilities` (`src/arena/interactions.ts:23`) and two type-only imports (`src/arena/prompts.ts:7`, `src/arena/narrative.ts:9`) |

So `combat.ts` contributes one function to live code and 480-odd lines of
resolution logic that nothing calls. This is shelving an unfinished feature, not
removing a working one. Mark `/arena` "coming soon" and leave the Node code in
git history; the conversion path is documented below.

### The playground rotation and help scheduler

`src/channels/playground.ts` (306), `src/playground/*` (1,438), and
`src/help/scheduler.ts` (170). All five rotation modes (spotlight, postcard,
discovery, encounter, recap) post into `PLAYGROUND_CHANNEL_ID`, which is a dead
channel id. Coming soon.

### Lore

`src/channels/lore.ts` (369), `src/lore/*` (407), `src/api/google-ai.ts` (374),
`src/api/openrouter.ts` (130). Posts into the dead `LORE_CHANNEL_ID`, costs
Google AI and OpenRouter keys, and generates narrative nobody currently reads
because the server is dark. Coming soon.

### Commands cut from 17 to 8

`src/commands/index.ts:334-351` registers seventeen commands. Keep the market
and lookup cluster: `/bot`, `/artifact`, `/floor`, `/sales`, `/listings`,
`/owner`, `/rarity`, `/activity`. Drop `/arena`, `/spotlight`, `/random`,
`/tips`, `/stats`, `/wallet`, `/mybots`, `/help`, `/info`.

`/wallet` and `/mybots` deserve a note: they are not broken, they depend on
`src/lib/wallet-state.ts` (172 lines) writing wallet bindings to the same local
state file that is now gone. Reinstating them means picking a store for
per-user data. That is a decision, not a port, so they wait.

### Twitter (not previously scoped, flagged here)

`opensea-activity-bot` also posts to Twitter: `src/platforms/twitter/twitter.ts`
(489) plus `src/platforms/twitter/utils.ts` (211) and the `AsyncQueue` in
`src/utils/queue.ts` (281). The stated scope is "sales + listings feed" with no
mention of Twitter. `twitter-api-v2` v1 media upload uses Node streams and will
not port cleanly. Treat Twitter as out of scope until the user says otherwise
(open question 5).

### Conversion path for everything shelved

Whenever a shelved feature is revived, the same four mechanical changes apply,
and they are the same four this plan performs on the in-scope code:

1. `Client` / `TextChannel` / `Interaction` object model becomes raw REST calls
   through `@discordjs/rest`, keeping `@discordjs/builders` for embeds.
2. `setInterval` loops become cron triggers or DO alarms.
3. Local state files become DO storage or KV.
4. Module-scope `process.env` reads become request-scoped `env` parameters.

The arena additionally needs combat resolution written, and its per-battle state
(`src/arena/state.ts`, 736 lines, `src/arena/persistence.ts`, 113) needs a real
store. The playground rotation needs a scheduling model (its
`src/playground/rate-limit.ts` is 298 lines of in-memory bookkeeping).

## The Discord application cutover

There are four registered applications: Activity, Embed, Oracle, Coral. Coral is
untouched and shares nothing with this work.

**Oracle's token and application id survive.** Rationale: Oracle is the app with
the most in-scope surface (mints plus all eight commands), it already has 17
guild-scoped commands registered against the live guild, and its bot member is
the one the guild's channel permissions are set up for. Adopting Embed's or
Activity's identity would mean re-inviting a bot and redoing permissions for a
smaller share of the work.

What Oracle needs that it does not have today:

| Requirement | Today | Needed |
|---|---|---|
| Interactions endpoint URL | unset (gateway-based, `src/index.ts:986` equivalent `client.login`) | set to `https://<worker-host>/discord/interactions`, Discord will probe it before saving |
| `MESSAGE_CONTENT` intent | not requested (`src/index.ts:3` imports `GatewayIntentBits`, Oracle never asked for it) | enabled in the developer portal, privileged |
| `GUILD_MESSAGES` intent | not requested | requested in IDENTIFY |
| Registered commands | 17 guild-scoped | 8 |

`MESSAGE_CONTENT` is the gating item. Embed already has it approved
(`discord-nft-embed-bot/src/index.ts:955-962` requests
`Guilds | GuildMessages | MessageContent`, and its README:107 documents the
portal toggle), but the approval is per application and does not transfer.
Discord closes the gateway with code 4014 when a privileged intent is requested
without approval, which is a fatal close code in Coral's handling
(`/Users/rg/dev/coral/packages/worker/src/durable-objects/discord-gateway.ts:170-177`)
and must be here too: fail loud, do not reconnect-loop.

For a bot in fewer than 100 guilds the toggle is self-serve in the portal, no
review. GlyphBots is one guild. Expect this to take minutes, not the weeks a
verified-bot review takes. Verify it before Phase 3 starts, not during.

### Migration order

The order matters because users must never see a command that no longer answers.

1. Deploy the Worker with `/discord/interactions` responding to PING only. Set
   the interactions endpoint URL in the portal. Discord's probe is the test.
2. Register the 8 commands guild-scoped with a single
   `PUT /applications/{app}/guilds/{guild}/commands` carrying exactly those 8.
   The `PUT` is a full replacement, so the other 9 disappear in the same call
   with no window where a stale command exists. This is what
   `src/commands/deploy.ts:62-64` already does; only the array changes.
3. Once step 2 lands, Oracle answers all 8 over HTTP. Only then flip the
   gateway on for MESSAGE_CREATE.
4. Embed and Activity: delete their guild-scoped commands (Activity registers
   none; Embed registers none, it is message-driven only, see
   `discord-nft-embed-bot/src/index.ts:978-983`), then kick both bot members
   from the guild. Their applications can stay registered in the portal
   indefinitely at zero cost; deleting them is optional cleanup, not a step.

Because neither Embed nor Activity registers slash commands, there is no
dead-command hazard from them. The only pruning is Oracle's 17 to 8.

## discord.js must go

`discord.js` is imported by 38 files under `glyphbots-discord-bot/src`. It
cannot run on Workers: `Client.login` opens a gateway WebSocket through `ws` and
`zlib-sync` and assumes a long-lived Node process.

The split is favourable. Counting usages across `src`:

| Symbol class | Occurrences | Workers-safe? |
|---|---|---|
| `EmbedBuilder`, `ButtonBuilder`, `ActionRowBuilder`, `SlashCommandBuilder`, `AttachmentBuilder`, `ModalBuilder` | 256 | yes, `@discordjs/builders` is pure and bundles fine |
| `Client`, `TextChannel`, `ThreadChannel`, `ChatInputCommandInteraction`, `ButtonInteraction` | 28 files touched | no, must be rewritten |

So the builder-heavy code (which is most of the embed construction, all of
`src/lib/discord/embeds.ts` and `src/lib/discord/buttons.ts`) survives
unchanged. What dies is the object model: `interaction.deferReply()`,
`interaction.editReply()`, `channel.send()`, `channel.isSendable()`,
`client.channels.fetch()`.

Replacement is `@discordjs/rest` plus `discord-api-types`, exactly as Coral does
(`/Users/rg/dev/coral/packages/worker/src/routes/discord.ts:11-15`). Coral goes
further and uses bare `fetch` against `https://discord.com/api/v10` for the hot
paths (`/Users/rg/dev/coral/packages/worker/src/community-bot/edge-ack.ts:44`,
`/Users/rg/dev/coral/packages/worker/src/routes/discord-community-bot-helpers.ts:109`).
Either is fine; prefer `@discordjs/rest` for its built-in 429 handling on the
cron paths, bare `fetch` on the interaction reply path where latency matters.

Concretely, in-scope files needing the object-model rewrite:

- `src/channels/mints.ts` (434), `TextBasedChannel.send` at :190 and :224,
  `isSendable()` at :184 and :217.
- `src/lib/discord/channels.ts` (63), the whole file, it is
  `client.channels.fetch` wrapping.
- The 8 in-scope command handlers, `deferReply`/`editReply` (see next section).
- `src/lib/discord/errors.ts` (85), interaction error replies.

`ethers` in the Embed and Activity repos is used only for `formatUnits`
(`discord-nft-embed-bot/src/lib/utils.ts:1`). Drop the dependency and inline the
formatting.

## Defer semantics invert

Under a gateway client, `interaction.deferReply()` is a call you make and then
keep working in the same async function. Under HTTP interactions, the deferral
**is** the response body. You return

```json
{ "type": 5 }
```

within Discord's 3 second ack window, and the real work continues in
`ctx.waitUntil(...)`, finishing with a follow-up webhook call. If the handler
returns before scheduling the continuation, the interaction dies as "The
application did not respond."

Coral has the exact reusable shape:
`deferAndFollowUp` in
`/Users/rg/dev/coral/packages/worker/src/routes/discord-community-bot-helpers.ts:155-186`
runs `build()` inside `envCtx.waitUntil`, ships the result through
`followUpWithContent` (`:103-124`, a `POST /webhooks/{appId}/{token}`), catches
every throw so a deferred interaction is always answered, and returns
`{ type: InteractionResponseType.DeferredChannelMessageWithSource }`.

Note that Coral uses `POST /webhooks/{app}/{token}` (create follow-up) rather
than `PATCH /webhooks/{app}/{token}/messages/@original` (edit the deferred
placeholder). Both work. `PATCH @original` is the closer analogue of
`editReply()` and produces one message instead of a placeholder plus a follow-up
in the ephemeral case. Pick `PATCH @original` for the eight commands here since
every one of them is a single-message reply, and note the deviation from Coral
in the code.

All eight in-scope commands defer today and therefore all eight need this
rewrite:

| Command | `deferReply()` |
|---|---|
| `/bot` | `src/commands/bot.ts:160` |
| `/floor` | `src/commands/floor.ts:51` |
| `/artifact` | `src/commands/artifact.ts:92` |
| `/sales` | `src/commands/sales.ts:50` |
| `/owner` | `src/commands/owner.ts:28` |
| `/rarity` | `src/commands/rarity.ts:65` |
| `/listings` | `src/commands/listings.ts:35` |
| `/activity` | `src/commands/activity.ts:101` |

Four of them also attach link-button rows (`src/commands/activity.ts:127`,
`src/commands/floor.ts:123`, `src/commands/listings.ts:66`,
`src/commands/bot.ts:227`). Those are all `ButtonStyle.Link`
(`src/lib/discord/buttons.ts:18`, `:30`), so there is no component interaction
to route back. No `/discord/interactions` component handler is needed for the
in-scope set.

## Module-scope `process.env` breaks

On Workers there is no `process.env` at module scope. Bindings arrive per
request or per scheduled invocation. Three captures in this repo break at import
time:

- `src/api/opensea.ts:23`, `const { OPENSEA_API_TOKEN } = process.env`, baked
  into the frozen `GET_OPTS` header object at `:24-31`. Every OpenSea call would
  ship `X-API-KEY: ""`.
- `src/api/glyphbots.ts:17`, `const API_BASE_URL = process.env.GLYPHBOTS_API_URL ?? DEFAULT_GLYPHBOTS_API_URL`.
  This one degrades gracefully to the default, so it is a latent bug rather than
  an outage, but it still has to move.
- `src/lib/utils.ts:18`, `loadConfig()`, called once at boot from
  `src/index.ts` and throwing on missing `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` /
  `LORE_CHANNEL_ID` / `GOOGLE_AI_API_KEY`. Two of those four go away with lore.

The same pattern exists in both other repos and is worse there:

- `discord-nft-embed-bot/src/api/opensea.ts:38` bakes `OPENSEA_API_TOKEN` into
  a frozen `GET_OPTS` at `:41-47`; plus module-scope captures at
  `src/index.ts:58` (`DISCORD_TOKEN`, `RANDOM_INTERVALS`),
  `src/config/collection.ts:13-24` (eight vars), `src/state/state.ts:7`.
- `opensea-activity-bot/src/opensea.ts:21-28` (six vars, header baked at
  `:135-141`), `src/utils/utils.ts:70-75`, `src/utils/logger.ts:8`.

The fix is uniform: every API module takes an explicit config argument (or a
small `Ctx` object) built from `env` at the top of the request or scheduled
handler. No module-level singletons that read the environment. This is the
single most mechanical, most repetitive part of the port, and it touches every
API file in all three repos.

Loggers also need work: all three repos write through `process.stdout.write` /
`process.stderr.write` (`glyphbots-discord-bot/src/lib/logger.ts`,
`discord-nft-embed-bot/src/lib/logger.ts:65-69`,
`opensea-activity-bot/src/utils/logger.ts:60-64`) and two use `node:util`
`inspect`. Replace with `console` behind a small `createLogger` like Coral's.
Activity's optional `DEBUG_LOG_FILE` path (`src/utils/logger.ts:69-114`,
`appendFileSync` with size-based truncation) is deleted outright.

## State moves off local disk

Every state file across the three repos, and where it lands:

| Source | What it holds | Target | Why |
|---|---|---|---|
| `glyphbots-discord-bot/src/lib/state.ts:11,335-337` (`.state/glyphbots-discord-bot-state.json`), `mintsCursor` field | mint cursor: `lastMintedAtMs` plus up to 100 posted artifact ids (`:16`, `:35-42`) | `FeedStateDO` storage | read-modify-write once per 5 min tick with a held-back timestamp on failure. The DO input gate makes that atomic; KV's eventual consistency plus lack of compare-and-set would let two overlapping ticks clobber each other |
| same file, `lore` / `arena` / `playground` / `mints` `ChannelState` (`:44-50`) | last-post display metadata only, read by the startup banner (`src/index.ts` channel table) | deleted | it exists to print a startup summary. There is no startup on Workers |
| `glyphbots-discord-bot/src/lib/wallet-state.ts` (172) | user wallet bindings | not ported | `/wallet` and `/mybots` are out of scope |
| `discord-nft-embed-bot/src/state/state.ts:334-336` (`.state/embed-bot-state.json`) | `recentTokens` per channel (cap 50, `:16`), `lastRandomPost` per channel | KV | pure dedupe/decoration for the random-post feature. Loss costs one repeated token. Not worth a DO |
| `discord-nft-embed-bot/src/index.ts:565` `rotationIndex` | per-channel collection rotation, in memory, never persisted | KV or dropped | already resets every process restart today, so it is not load bearing |
| `discord-nft-embed-bot/src/api/opensea.ts:50,53` `slugCache` / `usernameCache` (LRU 10 / 100) | provider response cache | KV with TTL | Worker isolates are ephemeral; an in-isolate LRU gives a low hit rate |
| `opensea-activity-bot/src/utils/event-state.ts:239-245` (`.state/opensea-events-state-<addr>.json`) | **the cursor that matters**: `lastTimestamp`, `lastId`, plus a dedupe watermark with a 60 minute key window (`:233-238`) | `FeedStateDO` storage | see below |
| `opensea-activity-bot/src/utils/event-grouping.ts:60-75` `actorAgg` map + 2000-entry processed LRU | pending settle-window groups | `FeedStateDO` storage | see "The batcher" |
| `opensea-activity-bot/src/utils/logger.ts:69-114` `DEBUG_LOG_FILE` | debug log | deleted | `console` plus Workers observability |

### The one cursor whose loss causes real damage

`opensea-activity-bot`'s event cursor. Its resolution order is
`LAST_EVENT_TIMESTAMP` env, then the state file, then **`now`**
(`src/opensea.ts:348-385`, `resolveLastEventTimestamp`, sources
`"env" | "state_file" | "new"`). So losing the file does not fail loudly, it
silently sets the cursor to the current time and every sale and listing during
the outage is skipped forever. In the other direction, losing the dedupe
watermark inside the 120 second lag window
(`OPENSEA_EVENT_LAG_WINDOW`, default 120s, `src/opensea.ts:41-44`, applied at
`:409-412`) causes a burst of duplicate posts.

The state file is already gone with the droplet, so on first boot this cursor
starts from `now` no matter what. That is the correct behaviour for a cold
start: the guild has been dark, and replaying weeks of BAYC-or-GlyphBots sales
into `#trading-floor` on day one would be worse than starting clean. Seed it
deliberately (`LAST_EVENT_TIMESTAMP` equivalent) rather than letting the
fallback do it by accident, and log which source won on every tick.

Compare with the mint cursor, which is designed better: `lastMintedAtMs` derives
from the artifact's own `mintedAt` (`src/lib/state.ts:31-42`), never wall clock,
and `advanceCursor` (`src/channels/mints.ts:252-275`) holds the timestamp back
to at or below the oldest failed send while keeping successful ids in the
100-entry posted set, so a failed send retries next poll and a success never
double-posts through the rewind. Preserve that design exactly. It is already the
right shape for a stateless cron: it does not assume the process that fetched is
the process that posts.

Cold start behaviour is also already correct: `pollOnce` seeds without posting
the backlog when the cursor is absent (`src/channels/mints.ts:316-319`,
`seedCursor` at `:286-303`). On Workers that means the first cron tick after
deploy posts nothing and arms the cursor. Say so in the Phase 1 definition of
done so it is not mistaken for a failure.

## The settle-window batcher

`opensea-activity-bot` groups events so that a buyer sweeping ten NFTs produces
one message instead of ten. The concern is that this assumes process continuity.

It half does, and the half that matters is fixable cheaply.

The live path is `EventGroupManager` (`src/utils/event-grouping.ts:57-346`), not
the tx-hash `EventGroupAggregator` in `src/utils/aggregator.ts` (only its
`txHashFor` helper at `:22-31` is used elsewhere). Its key facts:

- Grouping key is the **actor**, not the transaction: `purchase:<buyer>`,
  `mint:<to>`, `listing:<maker>` and so on (`:216-262`).
- A group flushes when `rawCount >= minGroupSize && now - lastAddedMs >= settleMs`
  (`collectReadyActorGroups`, `:195-214`). Defaults are 60,000 ms settle and
  minimum group size 2 (`src/utils/constants.ts:13-14`, the 60s chosen to let
  OpenSea mint metadata populate).
- **There are no timers.** Flushing is entirely poll-driven. That is why
  `src/index.ts:204-206` calls the platform handlers even when the fetch
  returned zero events: the empty call is what flushes settled groups.
- Duplicate adds deliberately do not refresh `lastAddedMs` (`:100-107`) so a
  repeatedly-seen event cannot starve the window.
- Stale under-sized groups are pruned at `settleMs * 3` (`:340-345`).

So the algorithm is already a pure function of persisted state plus `Date.now()`
and a tick. The only thing that breaks on Workers is *where the map lives*: an
in-memory `Map` (`:60-68`) and a 2,000-entry LRU (`:73-75`) inside a process
that dies between cron ticks.

**Keep grouping. Move `actorAgg` and the processed set into `FeedStateDO`
storage, and let the one-minute cron be the tick.** The flush predicate is
unchanged. Consequences to accept:

- Flush latency is quantized to the cron period. With a 60s settle window and a
  `* * * * *` cron, a group settles 60 to 120 seconds after its last member.
  That is within the spirit of a 60s settle window.
- The processed set must be bounded and pruned on write, same as the existing
  LRU cap of 2,000, or DO storage grows without limit.
- A DO storage read plus write per tick, on a cron that runs 1,440 times a day.
  That is trivial volume.

Dropping grouping is the alternative and it is not free: a ten-item sweep would
post ten embeds at three seconds apart (the current pacing is a hardcoded 3,000
ms `await timeout` between messages, `src/platforms/discord/discord.ts:155-157`),
which is thirty seconds of channel spam and, on Workers, thirty seconds of
sitting in a `waitUntil`. Grouping is the cheaper option once the state is
persisted.

## Dropping `sharp`

The framing needs correcting before the fix. `sharp` here is **not** resizing.
Its only call site is `convertSvgToPng` (`opensea-activity-bot/src/utils/utils.ts:198-221`),
which does `sharp(Buffer.from(fixedSvg)).png().toBuffer()` with no resize and no
dimensions, preceded by a regex that rewrites every `font-family` to a monospace
stack (`:205-210`) so unicode glyphs render. It is invoked from
`fetchImageBuffer` (`:228-266`) only when the fetched image's mime type is
`image/svg+xml` or the URL ends in `.svg` (`:260-265`). The result is attached as
an `AttachmentBuilder` and referenced by `attachment://` in the embed
(`src/platforms/discord/utils.ts:226-236`, `:275`).

So "let Discord scale the image" does not apply: Discord embeds do not render
SVG at all. If the upstream image is SVG and we drop `sharp` without a
replacement, the embed shows no image.

**The GlyphBots-specific answer avoids the problem entirely.** GlyphBots already
serves first-party PNGs by token id. Verified live on 2026-07-25:

```
GET https://glyphbots.com/bots/pngs/1.png
  HTTP/2 200, content-type: image/png, content-length: 24156
```

and the helper for it already exists in this repo at
`src/api/glyphbots.ts:199-200` (`getBotPngUrl`). Artifact images are already
JPEG on Vercel blob storage, verified from the live API:

```
"imageUrl": "https://sbb5m1zk7m16e5xt.public.blob.vercel-storage.com/artifacts/7963/1785030725084.jpg"
```

which is why `src/channels/mints.ts:133` can call `embed.setImage(url)`
directly with no attachment.

Therefore: **set `embed.image.url` to the first-party PNG/JPEG URL and never
fetch image bytes into the Worker at all.** No `sharp`, no
`AttachmentBuilder`, no `fetchImageBuffer`, no `attachment://`, no subrequest
per image, no CPU spent on rasterization.

Visual difference from today: none for artifacts (already raster). For bot NFTs,
the image comes from `glyphbots.com` rather than OpenSea's CDN, so OpenSea's
cache-warming and their `w=` size parameters no longer apply. The 24 KB PNG
above is well under Discord's embed limits. Discord's proxy will re-encode and
scale it for display exactly as it does any other embed image URL.

**Unverified.** Whether OpenSea's `image_url` for the GlyphBots contract
(`0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075`) is SVG or raster could not be
checked: the OpenSea v2 NFT endpoint requires an API key and none was used
during planning. It does not change the recommendation (we bypass OpenSea's
image URL either way) but it does change how urgent a fallback is. Check it in
Phase 0.

If a future collection genuinely needs SVG rasterization, the Workers-native
options are `resvg-wasm` or `@cf-wasm/photon` in-bundle, or Cloudflare Images as
a hosted transform. Neither is needed for GlyphBots.

## Phased execution

Each phase is independently shippable and independently useful. Do not start
phase N+1 before phase N's definition of done is met.

### Phase 0. Pre-flight, no code

Decisions and portal work that block later phases and cost nothing to do now.

- Enable `MESSAGE_CONTENT` and `GUILD_MESSAGES` on the Oracle application.
- Confirm the Oracle bot member is still in the guild with View Channel and Send
  Messages on `#general` and `#trading-floor`.
- Confirm the OpenSea API key still works (`GET /api/v2/collections/glyphbots/stats`).
- Check the OpenSea `image_url` mime for the GlyphBots contract (the one
  unverified item above).
- Create the Cloudflare Worker, KV namespace, and Workers Paid subscription
  (Durable Objects require it).

**Done when:** all five verified, and a `wrangler whoami` plus an empty
`wrangler deploy` succeeds.

### Phase 1. Lights on: mints to #general

The shortest path from a dark guild to a live one. No interactions endpoint, no
gateway, no OpenSea feed.

- New Worker package: Hono app, `scheduled()` handler, `GET /health`.
- `FeedStateDO` with mint-cursor get/set only.
- Port `src/api/glyphbots.ts` with request-scoped config (kills the `:17`
  capture).
- Port `src/channels/mints.ts` cursor logic verbatim (`selectNewMints`,
  `advanceCursor`, `seedCursor`, the burst guard at
  `MINTS_MAX_POSTS_PER_POLL = 5`, `src/lib/constants.ts:49`), swapping
  `channel.send()` for `POST /channels/1445933084401864767/messages` and
  `resolveMintsCursor`/`recordMintsCursor` for DO storage.
- Keep `EmbedBuilder` from `@discordjs/builders`; `buildMintEmbed`
  (`src/channels/mints.ts:126-190`) needs no changes beyond the import.
- Cron `*/5 * * * *`, matching `MINTS_POLL_INTERVAL_MINUTES = 5`
  (`src/lib/constants.ts:46`).
- Port the existing `test/channels/mints.test.ts` so the cursor logic keeps its
  coverage.

**Done when:** the first tick seeds the cursor and posts nothing (expected), a
subsequent real mint appears in `#general` within 5 minutes with the correct
embed, and killing the Worker mid-send leaves the cursor held back so the mint
posts on the next tick rather than being lost or duplicated.

### Phase 2. Slash commands

- `POST /discord/interactions` with Ed25519 verification via Web Crypto,
  mirroring `/Users/rg/dev/coral/packages/worker/src/routes/discord.ts:117-133`
  and its `verifySignature` helper.
- A local `deferAndFollowUp` equivalent using `PATCH .../messages/@original`.
- Port the 8 handlers plus `src/api/opensea.ts` (request-scoped config, kills
  the `:23` capture), `src/lib/discord/embeds.ts`, `src/lib/discord/buttons.ts`.
- Rewrite `src/commands/deploy.ts` to register the 8-command array against the
  guild.
- Delete `src/lib/discord/channels.ts` and the `loadConfig()` boot path.

**Done when:** all 8 commands answer in the live guild inside Discord's 3s ack,
`/commands` shows exactly 8, and no interaction produces "The application did
not respond" over a full manual pass.

### Phase 3. Gateway DO and inline lookups

- `GatewayDO`, modelled directly on
  `/Users/rg/dev/coral/packages/worker/src/durable-objects/discord-gateway.ts`:
  hibernating WebSocket, IDENTIFY/RESUME, `alarm()`-driven heartbeat with ack
  tracking, backoff schedule, fatal close codes fail loud rather than loop
  (`:166-173`).
- Intents: `GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT`. Do not request
  `GUILD_MEMBERS`, nothing in scope needs it.
- Admin routes `/connect`, `/status`, `/reconnect` mirroring
  `/Users/rg/dev/coral/packages/worker/src/routes/community-bot-discord.ts`, plus
  a watchdog cron poking `/health-tick` like
  `/Users/rg/dev/coral/packages/worker/src/inngest/functions/community-bot-discord-watchdog.ts`.
- Port the lookup parsing from `discord-nft-embed-bot/src/config/collection.ts`:
  the token regex at `:444-457` and the username regex at `:575-588`, plus the
  reserved-word filter at `:593-601`.
- Port embed construction from `discord-nft-embed-bot/src/index.ts:232-249`,
  capped at `MAX_EMBEDS_PER_MESSAGE = 6` (`src/config/constants.ts:6`).
- **Add what Embed never had:** a per-channel rate limit. Embed has none
  (verified: no cooldown, no debounce anywhere), and one embed costs five or
  more sequential OpenSea calls (`src/index.ts:174-200`), so six embeds in one
  message is 30-plus subrequests. Copy Coral's shape: a fixed window per channel
  (`RATE_LIMIT_WINDOW_MS = 60_000`, `RATE_LIMIT_MAX = 10`,
  `/Users/rg/dev/coral/packages/worker/src/durable-objects/discord-gateway.ts:156-157`).
- Gate on the guild id and drop bot authors, as Coral does at
  `discord-gateway.ts:1167`.

**Done when:** `b#123`, `a#123`, `#username` and `#random` all reply in
`#show-and-tell` and `#general`, the DO survives a forced reconnect via
`/reconnect` and resumes without replaying messages, and a burst of ten lookups
in one minute produces at most the rate-limit cap.

### Phase 4. OpenSea sales and listings to #trading-floor

- Port `opensea-activity-bot/src/opensea.ts` fetch and pagination
  (`collectPaginatedEvents`, `:479-556`) with request-scoped config.
- Move the cursor (`src/utils/event-state.ts`) into `FeedStateDO`, seeded
  explicitly rather than via the `now` fallback.
- Move `EventGroupManager`'s `actorAgg` and processed set into DO storage; the
  flush predicate at `:195-214` is unchanged. Convert the four runtime
  `require()` calls (`event-grouping.ts:496,542,547,671`) to static imports so
  the bundle builds.
- Replace `AttachmentBuilder` + `fetchImageBuffer` + `sharp` with a plain image
  URL on the embed. Delete `convertSvgToPng`.
- Restrict `DISCORD_EVENTS` to sale and listing, targeting
  `#trading-floor` (`1446247601942036574`). Note the current `.env` in that repo
  points at BAYC in a test server (`TOKEN_ADDRESS="0xbc4ca0..."`,
  `DISCORD_EVENTS=1446178009571659819=...`); the GlyphBots contract must be set.
- Replace the 3,000 ms inter-message `await timeout` (`discord.ts:155-157`) with
  a cap on messages per tick, deferring the remainder to the next tick. A cron
  invocation should not sleep.
- Cron `* * * * *`, matching the current `OPENSEA_BOT_INTERVAL` default of 60s
  (`src/utils/utils.ts:70`).

**Done when:** a real sale and a real listing each post to `#trading-floor`
within two minutes, a multi-item sweep posts as one grouped message, and
restarting the Worker mid-window does not lose the pending group or double-post
a settled one.

### Phase 5. Decommission and document

- Delete the arena, playground, lore, help-scheduler and out-of-scope command
  code from the active tree (git history keeps it), or move the whole port into
  a new `worker/` package and leave this repo's `src/` as the archive. Pick one
  and be consistent.
- README: replace the DigitalOcean/PM2 deployment section
  (`README.md:342-372`) with the Worker deployment.
- A "coming soon" note in the guild listing what is shelved, so the channel
  topics stop advertising features that do not answer.
- Archive `discord-nft-embed-bot` and `opensea-activity-bot`.

**Done when:** the README describes only the deployed system, and no shelved
feature is advertised anywhere a user can see it.

**How it was resolved (2026-07-26).** Archive, not delete, per decision 6. The
whole Node package moved to `legacy/` unchanged: `src/`, `test/`, `scripts/`,
`package.json`, `jest.config.js`, both tsconfigs, `biome.jsonc`. The repo root is
now a container holding `worker/` (live), `legacy/` (retired), `plans/` and the
deploy workflow. `legacy/` still typechecks and its 251 tests still pass, run from
inside that directory; keeping them green costs nothing and makes the shelved
arena, playground and lore code easier to revive along the conversion path above.
The root README was rewritten around the Worker, and `legacy/README.md` says
plainly that it is not the live system. The guild notice is drafted at
`plans/guild-announcement.md` and has not been posted. Archiving the other two
repos is an operator step with a checklist in `EXECUTION.md`.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `MESSAGE_CONTENT` not approved on Oracle, gateway closes 4014 | Low (self-serve under 100 guilds) | Phase 3 blocked entirely | Enable in Phase 0, before any gateway code. Treat 4014 as fatal, no reconnect loop (Coral `discord-gateway.ts:170-177`) |
| OpenSea cursor starts from `now` by accident and the first days of sales are silently skipped | Medium (it is the coded fallback, `src/opensea.ts:348-385`) | Silent data loss, hard to notice | Seed explicitly in Phase 4, log the resolved source on every tick, alert if the source is ever `"new"` after the first run |
| OpenSea cursor loss inside the 120s lag window causes duplicate posts | Medium | Channel spam | Dedupe watermark lives in the same DO write as the cursor, so they cannot diverge |
| Mint cursor lost during the Phase 1 cutover | Low (it is already lost with the droplet) | First tick posts nothing | Expected, documented in Phase 1's definition of done |
| Interactions endpoint URL probe fails, portal refuses to save | Medium on first attempt | Phase 2 blocked | Deploy a PING-only handler first and let Discord's probe be the test, before touching command registration |
| Command pruning leaves users with dead commands | Low | Confusion | Single `PUT` guild-commands call is a full replacement, no intermediate state (`src/commands/deploy.ts:62-64`) |
| Worker subrequest limit hit by inline lookups | Medium | Replies truncate or fail | 6-embed cap already exists; add the per-channel rate limit in Phase 3; consider dropping the parallel last-sale/best-offer/best-listing trio (`discord-nft-embed-bot/src/index.ts:196-200`) to one call |
| Bot NFT images turn out to be SVG from OpenSea | Unknown, unverified | Embeds show no image on the sales feed | Use `getBotPngUrl` (`src/api/glyphbots.ts:199`) rather than OpenSea's `image_url`; verify in Phase 0 |
| The port is bigger than it looks because 38 files import discord.js | High | Schedule slip | Only the in-scope subset gets ported; the object-model rewrite touches 28 files but the 256 builder usages carry over unchanged |
| Grouped-message state grows unbounded in DO storage | Low | Storage cost, slow ticks | Keep the existing 2,000-entry cap and the `settleMs * 3` stale prune (`event-grouping.ts:340-345`) |
| Two crons overlap and double-post | Low | Duplicate messages | Cursor read-modify-write happens inside the DO, whose input gate serializes it |

## Decisions (resolved 2026-07-25)

All seven open questions are answered. Nothing below is still in the air.

| # | Question | Decision |
|---|---|---|
| 1 | Twitter in `opensea-activity-bot` | **Drop.** Discord only. ~980 lines including the queue are not ported. |
| 2 | OpenSea feed event types | **`sale` only.** Revised 2026-07-25 after measuring listing volume. |
| 3 | Mint feed overlap | **`mint` stays out of the OpenSea feed.** |
| 4 | Inline lookup channels | **Allowlist `#general` and `#show-and-tell`.** No DMs. |
| 5 | `RANDOM_INTERVALS` | **Port as a cron into `#gallery`.** |
| 6 | Repo layout | **This repo**, new `worker/` package, `src/` archived at Phase 5. |
| 7 | `/wallet` and `/mybots` storage | **Reserve a KV namespace, build nothing.** |

Notes that follow from these.

**1.** `src/platforms/twitter/**` is not ported. The code survives in the
archived repo if it is ever wanted, so this is reversible. It also removes the
Node stream dependency in the media upload path, which was the hard part of a
Workers port. Separately: `womptron` already covers the X presence, and its
media upload was just repaired against the v2 endpoint, so there is a working
reference if this is ever revisited.

**2.** Originally `sale` and `listing`. Revised to **`sale` only** on 2026-07-25
after probing the live API: listings run at roughly **176 per day** (24 events in
a 3.3 hour window), which is one operator running a relister. A raw listing feed
posts to `#trading-floor` about every eight minutes, indefinitely, and the
`EventGroupManager` settle window batches bursts without reducing daily volume.
Sales run at **1.24 per day** over a 40 day window, which is a readable cadence.
The listing path stays available behind config if it is ever wanted with
floor-undercut gating, but it is not built now.

With both `offer` and `listing` dropped, `MIN_OFFER_ETH`
(`src/utils/utils.ts:71`) becomes dead config and should not be carried into the
Worker. Do not port the constant and then leave it unreferenced.

The feed cron is `*/5 * * * *`, not `* * * * *`. At 1.24 sales per day a
per-minute cron is 1,161 empty OpenSea calls per real event, and five minutes of
staleness is invisible on an event type that goes a week between clumps.

**3.** The GlyphBots API is the better mint source: it carries the artifact
title, type, source bot and image, where an OpenSea `mint` event sees only a
token transfer. One mint, one post, in `#general`.

**4.** This bounds the largest subrequest risk in the plan. One embed is five or
more sequential OpenSea calls (`discord-nft-embed-bot/src/index.ts:174-200`) and
a message can carry six embeds, so an unrestricted allowlist multiplies badly.
The two chosen channels are the ones whose topics advertise the syntax. Add the
per-channel rate limit noted in Phase 3 regardless; the allowlist is a bound, not
a substitute for it.

**5.** `#gallery` (`1445943861263208561`) is where this used to land, on a clean
six hour cadence, until it stopped on 2026-05-02. Its entire content stream was
this feature, so reviving it there restores a channel rather than inventing one.
Keep the cadence at six hours unless there is a reason to change it.

**6.** Keeping the repo preserves the history of the code being ported and the
shelved arena and playground source stays readable for the conversion path in
the section above. The name still describes the artifact.

**7.** Per-user keys (`wallet:<userId>`) in KV, provisioned and left empty. Two
reasons to decide it now rather than later: the storage layout hardens in Phase
1, and per-key writes fix a real lost-update race that the current whole-file
rewrite has today (`src/lib/wallet-state.ts:150-158` rewrites the entire file on
every `setUserWallet`). Build nothing until the commands come back.

## Cost

| | Old | New |
|---|---|---|
| Host | DigitalOcean Basic droplet, $5/mo (`README.md:346`) | Cloudflare Workers Paid, $5/mo |
| Why that tier | one always-on Node process, three bots under PM2 | Durable Objects are not available on the free plan, and the gateway DO plus `FeedStateDO` are load bearing |
| Included quota | 512 MB RAM, 1 vCPU, ~always saturated by three Node processes | 10M requests/mo, 30M CPU-ms/mo, 1M DO requests/mo, 400k DO GB-s/mo |
| Expected usage | n/a | ~2,000 cron invocations/day, a handful of interactions, one hibernating WebSocket. Comfortably inside the included quota |
| Observability | `pm2 logs`, plus Activity's optional `DEBUG_LOG_FILE` | Workers observability (enabled in `wrangler.jsonc` as Coral does) |
| Operational cost | droplet patching, PM2 restarts, disk state that dies with the box | none of that |

Net: a wash on the invoice, roughly $5/mo either way, with the durability and
patching problems removed. If usage ever exceeds the included quota the marginal
rates apply, but two crons and one guild will not get close.

The honest caveat: this is not a cost-saving migration and should not be sold as
one. It is a durability and maintenance migration. The thing that actually got
cheaper is the operator's time.
