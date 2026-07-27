/**
 * Register the eight guild commands, pruning the other nine.
 *
 * **This is an operator step. It is not wired into any npm script that runs on
 * its own, nothing in the Worker calls it, and it mutates the live guild.**
 * Run it by hand, once, after the Worker is deployed and the Interactions
 * Endpoint URL is saved in the developer portal.
 *
 *     DISCORD_TOKEN=... DISCORD_APP_ID=... npx tsx scripts/register-commands.ts
 *
 * Add `--dry-run` to print the payload and exit without calling Discord.
 *
 * It is one `PUT /applications/{app_id}/guilds/{guild_id}/commands`, which is
 * a full replacement of the guild's command set. There is no intermediate
 * state where a user sees a half-registered list: the nine commands not in
 * this payload disappear in the same call the eight are written in.
 *
 * Registered on the guild today (17): activity, arena, artifact, bot, floor,
 * help, info, listings, mybots, owner, random, rarity, sales, spotlight,
 * stats, tips, wallet. Nine of those go away.
 *
 * This file is not part of the Worker bundle. `wrangler.jsonc` points `main`
 * at `src/index.ts` and nothing under `src/` imports it, so the Node-only
 * `process.env` read below never reaches the Workers runtime. That is the one
 * place in this package where reading `process.env` is correct.
 */

import { commandDefinitions } from "../src/commands/definitions";
import { DISCORD_API, GUILD_ID } from "../src/config";

/**
 * Node's `process`, declared locally rather than pulled in with `@types/node`.
 * The Worker's `types` is `@cloudflare/workers-types` only and stays that way;
 * adding Node globals to the project would make `process.env` typecheck inside
 * `src/`, which is exactly the mistake this migration exists to prevent.
 */
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit: (code: number) => never;
};

const EXPECTED_COMMAND_COUNT = 8;

const fail = (message: string): never => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  const token = process.env.DISCORD_TOKEN;
  const appId = process.env.DISCORD_APP_ID;
  const dryRun = process.argv.includes("--dry-run");

  if (commandDefinitions.length !== EXPECTED_COMMAND_COUNT) {
    fail(
      `Expected ${EXPECTED_COMMAND_COUNT} command definitions, found ${commandDefinitions.length}. Refusing to register a set that does not match the plan.`
    );
  }

  console.log(`Guild:    ${GUILD_ID}`);
  console.log(`Commands: ${commandDefinitions.map((c) => c.name).join(", ")}`);
  console.log(
    "This PUT replaces the guild's entire command set, pruning anything not listed above."
  );

  if (dryRun) {
    console.log("\n--dry-run, nothing sent. Payload:\n");
    console.log(JSON.stringify(commandDefinitions, null, 2));
    return;
  }

  if (!token) {
    fail("DISCORD_TOKEN is required");
  }
  if (!appId) {
    fail("DISCORD_APP_ID is required");
  }

  const response = await fetch(
    `${DISCORD_API}/applications/${appId}/guilds/${GUILD_ID}/commands`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify(commandDefinitions),
    }
  );

  if (!response.ok) {
    fail(`Discord returned ${response.status}: ${await response.text()}`);
  }

  const registered = (await response.json()) as Array<{ name: string }>;
  console.log(`\n✅ ${registered.length} commands registered:`);
  for (const command of registered) {
    console.log(`   /${command.name}`);
  }
};

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
