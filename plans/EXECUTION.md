# GlyphBots consolidation: execution tracker

> **Read this first if you are picking this work up cold.** It is the running
> state of the migration. The design lives in
> [`cloudflare-consolidation.md`](cloudflare-consolidation.md); this file tracks
> what is done, what is next, and what only a human can do.
>
> **Status 2026-07-25.** Phases 0 to 5 not started. Mint watcher and the
> boot-crash fix are shipped on the Node bot but not deployed anywhere. The
> guild has been dark for months and there is no time pressure, so correctness
> beats speed on every call here.

## The situation in five lines

The DigitalOcean droplet was cancelled, so all three bots are down. `bot-runner`
supervised them and is being deleted, not migrated. Three Discord applications
(Activity, Embed, Oracle) collapse into one Cloudflare Worker. The fourth app,
Coral, is untouched and stays where it is. The live guild has nine channels and
about 30 members, and only `#general` is active.

## Decisions already locked

Do not relitigate these. They came from the operator directly.

| Area | Decision |
|---|---|
| Host | One Cloudflare Worker. Not containers, not Vercel, not a new droplet. |
| Sequencing | Port directly, downtime accepted. No bridge deployment. |
| Channels | Consolidate into existing channels. Create none. |
| Arena, playground, lore | Shelved as "coming soon" with a conversion path. |
| Commands | 8 market and lookup only. 17 registered today, prune to 8. |
| Twitter in the sales feed | Dropped. Discord only. |
| Feed events | **`sale` only.** `listing` dropped 2026-07-25 (see Preflight). `mint` excluded. |
| Inline lookups | Allowlist `#general` and `#show-and-tell`. No DMs. |
| `RANDOM_INTERVALS` | Cron into `#gallery`, six hour cadence. |
| Repo | This one. New `worker/` package. `src/` archived at Phase 5. |
| Per-user state | Reserve a KV namespace, build nothing. |
| womptron | Revived separately, X URL dropped, ~$0.54/mo. Not part of the Worker. |

## Channel and guild ids (verified live against the Discord API)

```
guild                1445933082938183743   GlyphBots, ~30 members
#general             1445933084401864767   only active channel; MINTS land here
#gallery             1445943861263208561   RANDOM_INTERVALS cron target
#show-and-tell       1446248716536123502   inline lookups allowed
#trading-floor       1446247601942036574   OpenSea sale/listing feed target
#fan-art             1446248449115816230
#degen-dungeon       1446254376078544896
#tech-talk           1450315319704027287
#introduce-yourself  1446248118155739227
Voice/General        1445933084401864768
```

The `LORE_CHANNEL_ID`, `ARENA_CHANNEL_ID` and `PLAYGROUND_CHANNEL_ID` values in
`.env` are all **404 Unknown Channel**. They were deleted from the guild. Remove
them, do not try to resolve them.

## Phase status

| Phase | What | Status |
|---|---|---|
| 0 | Pre-flight: portal toggles, key checks, Cloudflare provisioning | **not started** |
| 1 | Lights on: Worker skeleton, `FeedStateDO`, mints to `#general` | not started |
| 2 | Slash commands: Ed25519 endpoint, 8 handlers, prune 17 to 8 | not started |
| 3 | Gateway DO, inline `b#`/`a#` lookups, `#gallery` cron | not started |
| 4 | OpenSea sale/listing feed to `#trading-floor`, drop `sharp` | not started |
| 5 | Decommission, archive the other two repos, rewrite the README | not started |

Definitions of done are per-phase in `cloudflare-consolidation.md`.

## Blocked on a human (nobody can automate these)

These gate real work, so clear them early.

1. ~~**Enable `MESSAGE_CONTENT` on the Oracle application.**~~ **Done
   2026-07-25.** The operator confirms all three privileged intents (Presence,
   Server Members, Message Content) are enabled on Oracle. Phase 3 is unblocked.
   The guild is far under the 10,000 user threshold that would require review.
   Note that Presence and Server Members are enabled but not needed by anything
   in scope; only Message Content is, and only for the inline lookups.
2. **Confirm the Cloudflare account is on Workers Paid.** Durable Objects are
   not available on the free plan, and both the gateway DO and `FeedStateDO` are
   load bearing. Blocks Phase 1.
3. **`wrangler login` and `wrangler secret put`** for `DISCORD_TOKEN`,
   `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`, `OPENSEA_API_TOKEN`.
4. **Smoke test each phase in the live guild.** Embed rendering, gateway
   connection stability over days, and the first real OpenSea tick cannot be
   verified from tests.

## What is already shipped

On branch `feat/mint-watcher-and-cloudflare-plan`, commit `69ef2cf`:

- `src/channels/mints.ts` plus 21 tests. This is the **reference implementation**
  for Phase 1. Port its cursor logic verbatim rather than redesigning it.
- The boot-crash fix. `initLoreChannel` threw on an unfetchable channel and
  `index.ts` turned that into `process.exit(1)`, so the bot logged in and
  immediately died against the current `.env`. Channels now fail soft.
- `plans/cloudflare-consolidation.md` and this file.

Elsewhere: `womptron` on `fix/x-api-costs-and-v2-media` (`7d0eaa75`), and
`coral` on `docs/always-on-runtime-evaluation` (`aeb1809d`). All three branches
are unmerged and unpushed.

## The cursor design, because it is the thing most likely to be redone wrong

Two fields, persisted together.

`lastMintedAtMs` is the max `mintedAt` across every mint handled, parsed from the
artifact's own data and never from `Date.now()`, so a restart or a slow poll
cannot silently skip a window. Selection compares with `>=`, inclusive, which
deliberately re-admits anything sharing the boundary timestamp.

`postedArtifactIds` is the last 100 ids and is what actually rejects. Because the
timestamp filter is inclusive it re-surfaces boundary artifacts every poll, and
the id set makes that harmless. It also covers API reordering and backfill.

When a send fails, the timestamp is held back to sit at or below the oldest
failure so that mint is selectable again next poll, while the successful ids stay
in the set so they do not repost during that rewind. A cold start (cursor
genuinely absent, not empty) seeds from the current newest mint and posts
nothing, so reviving the bot never dumps the backlog.

The same shape applies to the OpenSea feed cursor in Phase 4, with one addition
noted under Risks: seed it explicitly and log the resolved source every tick.

## Preflight findings (probed live 2026-07-25)

Real numbers, measured against the live APIs. These changed four things.

| What | Measured | Consequence |
|---|---|---|
| Mint rate | 0.20/day (50 mints over 249 days); `summary` says 2 in the last 30d | The feed is quiet by nature. `*/5` poll and a burst cap of 5 are both correct: max observed in any 5 minute window over 250 days is 3, so the guard is sized right and will essentially never fire. |
| Sale rate | 1.24/day (50 events over 40 days), clumped | Feed cron is `*/5`, not `* * * * *`. Per-minute would be 1,161 empty calls per real sale. |
| Listing rate | ~176/day (24 events in 3.3 hours) | **`listing` dropped from the feed.** A raw feed posts every 8 minutes forever, mostly one relister's wash activity. |
| OpenSea `image_url` | `image/svg+xml`, confirmed on token 1 | **Hard rule, not a risk:** every OpenSea-sourced embed uses `getBotPngUrl` (`src/api/glyphbots.ts:199`), never `image_url`. Discord renders nothing for SVG. Applies to Phase 3 lookups and Phase 4 sales. |
| Artifact images | 7 to 8 MB JPEG/PNG | Discord proxies embed images and may fail to thumbnail large sources. **Unverified**, needs one manual post in the Phase 1 smoke test. |
| `glyphbots.com` | 307s to `www.glyphbots.com` on every API path | Set `DEFAULT_GLYPHBOTS_API_URL` to the `www` host. Undici follows silently today; on Workers it costs a subrequest per call. |
| Oracle app flags | `565248` = presence + guild members + **`GATEWAY_MESSAGE_CONTENT_LIMITED`** | `MESSAGE_CONTENT` granted. `_LIMITED` is the enabled state under 100 guilds, not pending. |
| Registered commands | 17, all 8 in-scope names present | Phase 2's single `PUT` prunes 9. |
| In-scope port surface | 1,076 lines across 8 handlers, 1,664 with direct deps, out of 13,869 in `src/` | 7.8% of the tree. All 8 import the same six discord.js symbols: four builders (Workers-safe) and two type-only. **Zero use of the `Client`/`Channel` object model.** |

One follow-up the port must handle: `src/commands/bot.ts:181` calls `getUserWallet`
from `src/lib/wallet-state`, the only in-scope dependency on per-user storage that
decision 7 says not to build. It needs a stub or removal in Phase 2.

Not verified and why: bot guild membership and channel permissions (needs
permission math outside the probe set), the Cloudflare account plan (human portal
work), and Discord's rendering of multi-megabyte embed images (needs a live post).

## Risks worth re-reading before each phase

1. **The OpenSea cursor fails silently.** Its fallback resolution order ends at
   `now` (`opensea-activity-bot/src/opensea.ts:348-385`), so losing it does not
   error, it skips every event during the gap. Seed explicitly, log the source
   per tick.
2. **`MESSAGE_CONTENT` approval** gates Phase 3 entirely. See above.
3. **Subrequest blowup on inline lookups.** One embed is five or more sequential
   OpenSea calls (`discord-nft-embed-bot/src/index.ts:174-200`), six embeds per
   message. The allowlist bounds it; add the per-channel rate limit anyway.
4. **Command pruning order.** Oracle has 17 guild-scoped commands registered and
   live in the UI right now. Users invoking them get failures until Phase 2
   replaces them with 8 in a single `PUT`.

## Corrections already made, so they are not re-made

- **`sharp` is not resizing.** Its only call site
  (`opensea-activity-bot/src/utils/utils.ts:198-221`) rasterizes SVG to PNG with
  a font-family rewrite. "Let Discord scale it" is wrong, because Discord embeds
  do not render SVG at all. The resolution is that GlyphBots serves first-party
  PNGs (`https://glyphbots.com/bots/pngs/1.png`, verified 200 `image/png`) and
  artifact images are already JPEG, so set an image URL and never fetch bytes.
- **The settle-window batcher does not need a resident process.**
  `EventGroupManager` has no timers and flushing is already poll-driven
  (`event-grouping.ts:195-214`). Only the in-memory `Map` breaks. Move it to DO
  storage and grouping survives, so there is no case for dropping it.
- **The arena is unfinished, not broken.** Combat resolution was never
  implemented (`src/arena/interactions.ts:552`) and `arena/images.ts`,
  `narrative.ts` and most of `combat.ts` are unreferenced. Shelving it removes
  nothing that ever worked.
- **`opensea-activity-bot`'s `.env` currently points at BAYC in a test server**,
  not GlyphBots. Phase 4 is closer to a first run than a migration.

## Related plan, different repo

`coral/plans/future/always-on-runtime-evaluation.md` answers whether Coral should
move to an always-on host. Verdict: no, do not migrate. Its three recommended
fixes (resident in-container process, raise `max_instances` above 1, add
stage-level instrumentation) are independent of this migration and can be done in
any order.
