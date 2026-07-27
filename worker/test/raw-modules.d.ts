/**
 * Vite serves any file as a string with a `?raw` suffix, and vitest runs on
 * Vite. `test/cron.test.ts` uses it to read the real `wrangler.jsonc`, which
 * cannot be imported as JSON because it is commented.
 *
 * Declared here rather than by referencing `vite/client`, which would pull a
 * large ambient surface into a project whose `types` is deliberately
 * `@cloudflare/workers-types` and nothing else.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
