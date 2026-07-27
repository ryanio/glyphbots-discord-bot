# Guild announcement draft

Not posted. This is a draft for the operator to paste into `#general`, edit as
you like. Keep it in one message. If it runs long, the "coming soon" lines are
the ones to cut.

Facts checked against `worker/src` on 2026-07-26: eight commands in
`worker/src/commands/definitions.ts`, the lookup channels in
`worker/src/config.ts:36-37`, the six hour `#gallery` cron in
`worker/wrangler.jsonc:19`.

---

**The bot is back up.**

It moved off the old server and onto Cloudflare, which is why it went quiet for
a while. Everything below works right now.

**Inline lookups.** Type `b#123` anywhere in a message and it posts that bot.
`a#123` does the same for an artifact, `#123` on its own means a bot, and
`#username` looks up an OpenSea account. `#random` picks one at random. The
channel topics have been advertising this for months; it finally answers. Works
in this channel and in #show-and-tell. Up to six per message.

**Slash commands.** Eight of them: `/bot`, `/artifact`, `/floor`, `/sales`,
`/listings`, `/owner`, `/rarity`, `/activity`. If you still see older commands
in the picker, give Discord a minute to catch up.

**New mints** post here automatically, and #gallery gets a random piece from the
collection every six hours.

**Not built yet:** the arena, the playground rotation and the lore posts. The
arena in particular was never finished, so it is not something that broke, it is
something that has not been written. No timeline on any of them. A sales feed
for #trading-floor is being worked on now.

Anything acting strange, say so here.
