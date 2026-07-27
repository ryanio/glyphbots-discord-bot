/**
 * The one random helper this package has.
 *
 * Four modules used to spell `Math.floor(Math.random() * max) + 1` inline: the
 * gallery pick, the nudge pick, `#random` in the inline matcher and `/bot
 * random:true`. Every caller wants the same thing, an integer in `[1, max]`
 * usable directly as a token id, and every one of them takes an injected
 * override in tests, so the shared version is what those overrides are
 * standing in for.
 */

/** An integer in `[1, max]`. `max` is inclusive, token ids start at 1. */
export const randomInt = (max: number): number =>
  Math.floor(Math.random() * max) + 1;
