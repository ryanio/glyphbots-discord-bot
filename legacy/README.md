# legacy: the retired Node bot

**This is not the live system.** The GlyphBots bot runs as a Cloudflare Worker
in [`../worker/`](../worker/). Nothing in this directory is deployed, and
nothing here has run since the DigitalOcean droplet was cancelled.

It is kept for two reasons. It is the source the Worker was ported from, so the
port's reference points stay readable. And the arena, playground and lore code
here is shelved rather than abandoned: the plan documents a conversion path for
each, in
[`../plans/cloudflare-consolidation.md`](../plans/cloudflare-consolidation.md)
under "Conversion path for everything shelved".

## What moved where

Phase 5 moved the whole Node package down one level, unchanged:

```
legacy/
  package.json  jest.config.js  tsconfig.json  tsconfig.build.json  biome.jsonc
  src/  test/  scripts/
```

Paths inside the package are relative, so nothing needed rewriting. Plan
documents written before the move refer to files as `src/foo.ts`; those are now
`legacy/src/foo.ts`. References to `worker/src/...` are unaffected.

## It still builds and tests

Deliberately. Retiring the tooling as well as the deployment would have made the
shelved code harder to revive, and a suite that has passed for months is cheap to
keep passing. From this directory:

```bash
npm install     # or yarn install
npx tsc --noEmit -p tsconfig.json
npx jest        # 16 suites, 251 tests
```

There is no CI for it. `.github/workflows/deploy-worker.yml` only watches
`worker/`, so changes here deploy nothing and gate nothing.

## What is actually still useful in here

- `src/channels/mints.ts` and its tests: the mint cursor design the Worker
  copied. The Worker's version is the one that runs.
- `src/arena/**`: unfinished. Combat resolution was never implemented
  (`src/arena/interactions.ts:552`), and `arena/images.ts`, `arena/narrative.ts`
  and most of `arena/combat.ts` are not referenced by anything outside the arena
  directory. Reviving the arena means writing the missing piece, not restoring a
  working feature.
- `src/playground/**`, `src/channels/playground.ts`, `src/help/scheduler.ts`:
  the rotation modes, which posted into a channel id that no longer exists.
- `src/lore/**`, `src/channels/lore.ts`, `src/api/google-ai.ts`,
  `src/api/openrouter.ts`: lore generation, also aimed at a deleted channel, and
  it costs Google AI and OpenRouter keys.
- `src/lib/wallet-state.ts`: what `/wallet` and `/mybots` wrote to. It rewrites
  the whole file on every set, which is a lost-update race the KV layout in the
  plan (decision 7) is meant to fix.

## What not to do with it

Do not point it at the live guild. Its command deploy script
(`src/commands/deploy.ts`) does a full `PUT` of guild commands and would wipe the
eight the Worker serves. Do not add features here; add them to the Worker.
